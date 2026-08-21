import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { env } from '@core/config/env';
import { PrismaAdapter } from '@core/database/sql/prisma.adapter';
import type { SqlClient } from '@core/database/sql/prisma.adapter';
import type { AppModule } from '@core/module';
import { cartModule } from '@modules/cart/cart.module';
import { catalogModule } from '@modules/catalog/catalog.module';
import { CatalogService } from '@modules/catalog/catalog.service';
import { customerModule } from '@modules/customer/customer.module';
import { notificationModule } from '@shared/notifications/notification.module';
import { authModule } from '@modules/auth/auth.module';
import { bearer, purgeActors, seedActor } from '@tests/actors';
import type { SeededActor } from '@tests/actors';
import type { Harness } from '@tests/harness';
import { PROVIDERS, startHarness } from '@tests/harness';
import { orderModule } from './order.module';

/**
 * The order module refuses to register without catalog, cart, customer and notifications, so
 * the list is the module's own dependency declaration read back.
 */
const MODULES: readonly AppModule[] = [
  notificationModule,
  authModule,
  catalogModule,
  cartModule,
  customerModule,
  orderModule,
];

const API = env.API_PREFIX;

const ADDRESS = {
  label: 'Maison',
  recipient: 'Aline Test',
  phone: '+2290197000000',
  city: 'Cotonou',
  district: 'Fidjrossè',
  line1: 'Rue 12.345, derrière la pharmacie',
};

describe.each(PROVIDERS)('order module on $name', ({ name }) => {
  let harness: Harness;
  let catalog: CatalogService;
  let client: SqlClient;

  const actorIds: string[] = [];
  const productIds: string[] = [];
  let categoryId = '';

  /**
   * Publishes a one-variant product straight through the service. Going through the admin HTTP
   * routes instead would make every assertion below depend on the catalog's authorisation
   * working, which is a different suite's job.
   */
  const publish = async (price: number, stock: number): Promise<string> => {
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const product = await catalog.createProduct({
      name: `Article de test ${suffix}`,
      description: 'Un article créé par la suite de tests du module order.',
      categoryId,
      status: 'active',
      basePriceCents: price,
    });
    productIds.push(product.id);

    const variant = await catalog.addVariant(product.id, {
      sku: `TEST-${suffix}`,
      name: 'Unique',
      priceCents: price,
      stock,
    });

    return variant.id;
  };

  const stockOf = async (variantId: string): Promise<number> =>
    (await client.productVariant.findUniqueOrThrow({ where: { id: variantId } })).stock;

  /** A signed-in customer with one address, which is the minimum a checkout needs. */
  const shopper = async (): Promise<{ actor: SeededActor; addressId: string }> => {
    const actor = await seedActor(harness.container, { actorType: 'customer' });
    actorIds.push(actor.id);

    const response = await harness.agent
      .post(`${API}/me/addresses`)
      .set('authorization', bearer(actor.accessToken))
      .send(ADDRESS);

    expect(response.status).toBe(201);

    return { actor, addressId: response.body.data.id as string };
  };

  const addToCart = async (actor: SeededActor, variantId: string, quantity = 1): Promise<void> => {
    const response = await harness.agent
      .post(`${API}/cart/items`)
      .set('authorization', bearer(actor.accessToken))
      .send({ variantId, quantity });

    expect(response.status).toBe(200);
  };

  beforeAll(async () => {
    harness = await startHarness(name, MODULES);
    catalog = harness.container.resolve(CatalogService);

    if (!(harness.adapter instanceof PrismaAdapter)) {
      throw new Error('This suite needs the SQL adapter');
    }

    client = harness.adapter.client;
    categoryId = (await catalog.createCategory({ name: `Tests ${randomUUID().slice(0, 8)}` })).id;
  });

  afterAll(async () => {
    // Orders are never soft-deleted — they are the shop's accounting record — so the suite
    // removes its own rows in dependency order rather than leaving them for the next run.
    await client.order.deleteMany({ where: { customerId: { in: actorIds } } });
    await client.cartItem.deleteMany({ where: { cart: { customerId: { in: actorIds } } } });
    await client.cart.deleteMany({ where: { customerId: { in: actorIds } } });
    await client.address.deleteMany({ where: { customerId: { in: actorIds } } });
    await client.productVariant.deleteMany({ where: { productId: { in: productIds } } });
    await client.product.deleteMany({ where: { id: { in: productIds } } });
    await client.category.deleteMany({ where: { id: categoryId } });
    await purgeActors(harness.adapter, actorIds);
    await harness.stop();
  });

  it('places an order, moves the stock and empties the cart in one transaction', async () => {
    const variantId = await publish(600_000, 5);
    const { actor, addressId } = await shopper();

    await addToCart(actor, variantId, 2);

    const placed = await harness.agent
      .post(`${API}/orders`)
      .set('authorization', bearer(actor.accessToken))
      .send({ addressId });

    expect(placed.status).toBe(201);
    expect(placed.body.data.reference).toMatch(/^CMD-\d{4}-[0-9A-HJ-KM-NP-TV-Z]{6}$/);
    expect(placed.body.data.status).toBe('pending_payment');
    expect(placed.body.data.subtotalCents).toBe(1_200_000);
    // Under the free-shipping threshold, so the flat fee applies.
    expect(placed.body.data.shippingCents).toBe(150_000);
    expect(placed.body.data.totalCents).toBe(1_350_000);
    expect(placed.body.data.items).toHaveLength(1);
    expect(placed.body.data.shipCity).toBe(ADDRESS.city);

    expect(await stockOf(variantId)).toBe(3);

    const cart = await harness.agent
      .get(`${API}/cart`)
      .set('authorization', bearer(actor.accessToken));

    expect(cart.status).toBe(200);
    expect(cart.body.data.items).toHaveLength(0);
  });

  it('refuses a checkout with an empty cart', async () => {
    const { actor, addressId } = await shopper();

    const response = await harness.agent
      .post(`${API}/orders`)
      .set('authorization', bearer(actor.accessToken))
      .send({ addressId });

    expect(response.status).toBe(409);
  });

  it('walks the status machine and rejects a move it does not allow', async () => {
    const variantId = await publish(400_000, 3);
    const { actor, addressId } = await shopper();
    const admin = await seedActor(harness.container, {
      actorType: 'agent',
      roles: ['admin'],
    });
    actorIds.push(admin.id);

    await addToCart(actor, variantId);
    const placed = await harness.agent
      .post(`${API}/orders`)
      .set('authorization', bearer(actor.accessToken))
      .send({ addressId });
    const orderId = placed.body.data.id as string;

    const paid = await harness.agent
      .post(`${API}/admin/orders/${orderId}/status`)
      .set('authorization', bearer(admin.accessToken))
      .send({ status: 'paid' });

    expect(paid.status).toBe(200);
    expect(paid.body.data.status).toBe('paid');
    expect(paid.body.data.paidAt).not.toBeNull();

    const skipped = await harness.agent
      .post(`${API}/admin/orders/${orderId}/status`)
      .set('authorization', bearer(admin.accessToken))
      .send({ status: 'delivered' });

    expect(skipped.status).toBe(409);

    // Money has changed hands: cancelling is no longer the customer's decision alone.
    const cancelled = await harness.agent
      .post(`${API}/orders/${orderId}/cancel`)
      .set('authorization', bearer(actor.accessToken))
      .send({});

    expect(cancelled.status).toBe(403);
  });

  it('puts the stock back when an unpaid order is cancelled', async () => {
    const variantId = await publish(300_000, 4);
    const { actor, addressId } = await shopper();

    await addToCart(actor, variantId, 2);
    const placed = await harness.agent
      .post(`${API}/orders`)
      .set('authorization', bearer(actor.accessToken))
      .send({ addressId });

    expect(await stockOf(variantId)).toBe(2);

    const cancelled = await harness.agent
      .post(`${API}/orders/${placed.body.data.id as string}/cancel`)
      .set('authorization', bearer(actor.accessToken))
      .send({ reason: 'Erreur de taille' });

    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('cancelled');
    expect(cancelled.body.data.cancelledAt).not.toBeNull();
    expect(await stockOf(variantId)).toBe(4);
  });

  it('shows an order only to the customer who placed it', async () => {
    const variantId = await publish(250_000, 2);
    const { actor, addressId } = await shopper();
    const stranger = await shopper();

    await addToCart(actor, variantId);
    const placed = await harness.agent
      .post(`${API}/orders`)
      .set('authorization', bearer(actor.accessToken))
      .send({ addressId });
    const orderId = placed.body.data.id as string;

    // 404 rather than 403: answering "forbidden" would confirm the reference exists.
    const peeked = await harness.agent
      .get(`${API}/orders/${orderId}`)
      .set('authorization', bearer(stranger.actor.accessToken));

    expect(peeked.status).toBe(404);

    const backOffice = await harness.agent
      .get(`${API}/admin/orders`)
      .set('authorization', bearer(actor.accessToken));

    expect(backOffice.status).toBe(403);

    const anonymous = await harness.agent.get(`${API}/orders`);

    expect(anonymous.status).toBe(401);
  });

  it('sells the last unit once when two customers check out at the same time', async () => {
    const variantId = await publish(350_000, 1);
    const first = await shopper();
    const second = await shopper();

    await addToCart(first.actor, variantId);
    await addToCart(second.actor, variantId);

    const [a, b] = await Promise.all([
      harness.agent
        .post(`${API}/orders`)
        .set('authorization', bearer(first.actor.accessToken))
        .send({ addressId: first.addressId }),
      harness.agent
        .post(`${API}/orders`)
        .set('authorization', bearer(second.actor.accessToken))
        .send({ addressId: second.addressId }),
    ]);

    // The whole point of the reservation being a single conditional UPDATE: one wins, the
    // other is told the item is gone, and the stock never goes below zero.
    expect([a.status, b.status].sort((x, y) => x - y)).toEqual([201, 409]);
    expect(await stockOf(variantId)).toBe(0);
  });
});
