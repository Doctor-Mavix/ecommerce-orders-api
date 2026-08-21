# Boutique — e-commerce API

An online shop built on the OrangCode Express + TypeScript template: catalogue, cart, orders,
customer addresses, order notifications by email and to the back office in real time.

**PostgreSQL only.** The template it comes from runs on Postgres _or_ MongoDB; a shop needs the
database itself to refuse a negative stock and to reject an order line pointing at a product
that no longer exists, so the MongoDB half was removed rather than left as a trap. `DB_PROVIDER`
accepts one value here, and any other stops the boot.

---

## Table of contents

- [What is in the box](#what-is-in-the-box)
- [Requirements](#requirements)
- [Installation](#installation)
- [Running it](#running-it)
- [The purchase journey, in curl](#the-purchase-journey-in-curl)
- [The API](#the-api)
- [The order state machine](#the-order-state-machine)
- [How the stock is protected](#how-the-stock-is-protected)
- [Notifications](#notifications)
- [Money](#money)
- [Project structure](#project-structure)
- [Configuration](#configuration)
- [Testing](#testing)
- [Scripts](#scripts)
- [Security summary](#security-summary)

---

## What is in the box

| Module         | What it owns                                                             |
| -------------- | ------------------------------------------------------------------------ |
| `auth`         | Accounts, sessions, MFA, audit trail. From the template, unchanged.      |
| `customer`     | Delivery addresses, scoped to the signed-in customer.                    |
| `catalog`      | Categories, products, variants, product images through the media kit.    |
| `cart`         | One cart per customer, priced live from the catalogue.                   |
| `order`        | Checkout as one SQL transaction, the status machine, the order timeline. |
| `notification` | In-app + email delivery. From the shared kit.                            |
| `health`       | Liveness and readiness.                                                  |

Two actor types: **`customer`** signs up on the storefront, **`agent`** works in the back
office. They are separate namespaces — the same address may hold one of each — and the pair
`(actorType, email)` is the identity. A registration always produces a role-less `customer`, so
nothing reachable over HTTP can mint an administrator.

---

## Requirements

- **Node.js >= 22** — pinned in `.nvmrc`, `nvm use` picks it up.
- **pnpm >= 10** — `corepack enable` is enough.
- **Docker** with Compose v2, for Postgres, Redis, MinIO and Mailpit.

Nothing else is installed on the machine: no local Postgres, no local Redis.

---

## Installation

```bash
nvm use
corepack enable
pnpm install                 # also runs `prisma generate`

cp .env.example .env
```

Fill the three secrets `.env` leaves empty. The process refuses to boot without them, and
refuses to boot if any two are equal:

```bash
# once per variable: JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, MFA_SECRET_KEY
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Start the stack, create the schema, fill the shop:

```bash
docker compose up -d
pnpm db:deploy               # apply the migrations
pnpm db:seed                 # 6 categories, 53 products, 89 variants, 2 demo accounts
```

The host ports are shifted off the defaults so this stack can run next to the other OrangCode
projects. Inside the compose network the services still use their standard ports.

| Service  | Host port | Note                                                      |
| -------- | --------- | --------------------------------------------------------- |
| Postgres | `5433`    | user / password / database: `shop` / `shop` / `ecommerce` |
| Redis    | `6380`    | rate limit, sessions, locks, queue, Socket.IO fan-out     |
| MinIO    | `9010`    | S3 API; console on `9011` (`shop` / `shop-secret`)        |
| Mailpit  | `1026`    | catches every outgoing email; web interface on `8026`     |

The seed refuses to run on a catalogue that already has categories, rather than producing a
second shop next to the first. It prints the two demo accounts:

| Account              | Actor type | Password        | Roles   |
| -------------------- | ---------- | --------------- | ------- |
| `admin@boutique.bj`  | `agent`    | `Seed!Passw0rd` | `admin` |
| `client@boutique.bj` | `customer` | `Seed!Passw0rd` | —       |

To create your own administrator instead:

```bash
pnpm admin:create --email you@example.org --password 'a-long-password'
```

---

## Running it

```bash
pnpm dev
curl http://localhost:3000/health
open http://localhost:3000/docs          # Swagger UI
open http://localhost:8026               # the emails the shop sent
```

---

## The purchase journey, in curl

Every step below is a route that exists; this is the walkthrough used to verify the project.
`$B` is `http://localhost:3000/api/v1`.

**1. Create an account and sign in.**

```bash
curl -X POST "$B/auth/register" -H 'Content-Type: application/json' \
  -d '{"email":"aicha@example.bj","password":"Test!Passw0rd1","displayName":"Aïcha Doassi"}'

curl -X POST "$B/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"aicha@example.bj","password":"Test!Passw0rd1"}'
# -> data.accessToken ; export TOKEN=…
```

An `agent` signs in with `"actorType": "agent"` in the same body. Without it the field defaults
to `customer`, and an agent's address in the customer namespace simply does not exist.

**2. Browse the catalogue.** No token: the storefront is public.

```bash
curl "$B/categories"
curl "$B/products?limit=20"
curl "$B/products?search=solaire&categoryId=…"
curl "$B/products/smartphone-atlas-a5"          # by slug, with its variants
```

Lists are cursor-paginated. The answer carries `meta.nextCursor`; pass it back as `?cursor=`.
There is no page number anywhere in this API — an offset drifts while rows are being inserted.

**3. Fill the cart.** Prices come from the catalogue, never from the client.

```bash
curl -X POST "$B/cart/items" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"variantId":"…","quantity":2}'

curl "$B/cart" -H "Authorization: Bearer $TOKEN"
```

Every cart route answers with the whole cart, because a client that changed one line still has
to redraw the totals and the availability of the rest. Each line reports `available`,
`priceChanged` and the live `stock`, and the cart as a whole reports `needsAttention`.

**4. Add a delivery address.**

```bash
curl -X POST "$B/me/addresses" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{
    "label":"Maison","recipient":"Aïcha Doassi","phone":"+22997000000",
    "city":"Cotonou","district":"Fidjrossè","line1":"Rue 12.345, maison bleue",
    "notes":"Portail vert en face de la pharmacie"
  }'
```

There is no customer id in the path: it comes from the token. The first address a customer
creates becomes the default one whether they ticked the box or not.

**5. Check out.**

```bash
curl -X POST "$B/orders" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"addressId":"…","notes":"Livrer avant midi"}'
```

The body carries an address id and an optional delivery note, and nothing else. The lines, the
prices, the shipping and the total are all read on the server: a total a client is allowed to
name is a total a client is allowed to choose.

In one transaction the shop reserves the stock, writes the order with its lines and its first
timeline entry, and empties the cart. The answer is the whole order, reference included
(`CMD-2026-4AHJ14`).

**6. Follow it.**

```bash
curl "$B/orders" -H "Authorization: Bearer $TOKEN"
curl "$B/orders/$ORDER_ID" -H "Authorization: Bearer $TOKEN"
curl -X POST "$B/orders/$ORDER_ID/cancel" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"reason":"Commande passée deux fois"}'
```

**7. Watch it arrive in the back office.** Sign in as the agent, open the realtime feed, and
place an order from another terminal:

```bash
pnpm realtime:watch --token "$ADMIN_TOKEN"
# order.placed {"reference":"CMD-2026-TPB0KF","totalCents":350000,"itemCount":1,…}
```

**8. Move it through its life.**

```bash
curl -X POST "$B/admin/orders/$ORDER_ID/status" -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' -d '{"status":"paid","message":"Paiement Mobile Money reçu"}'

curl -X POST "$B/admin/orders/$ORDER_ID/notes" -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' -d '{"message":"Client rappelé, livraison confirmée"}'
```

The customer gets an email and an in-app notification at each step; the back office gets the
event on its socket.

---

## The API

Everything below is prefixed by `API_PREFIX` (`/api/v1`), except `/health`, `/ready` and
`/docs`, which sit at the root because a load balancer should not have to know the prefix.

### Public — no token

| Method | Route                         | What it does                        |
| ------ | ----------------------------- | ----------------------------------- |
| `GET`  | `/categories`                 | The whole category list             |
| `GET`  | `/products`                   | Cursor page; `search`, `categoryId` |
| `GET`  | `/products/:slug`             | A product, its variants, its images |
| `GET`  | `/products/:productId/images` | The images of a published product   |

A product that is not `active` reads as 404 on these routes, whoever asks.

### Customer — a `customer` token

| Method   | Route                    | What it does                       |
| -------- | ------------------------ | ---------------------------------- |
| `GET`    | `/cart`                  | The cart, priced live              |
| `POST`   | `/cart/items`            | Add a variant (quantity adds up)   |
| `PATCH`  | `/cart/items/:variantId` | Set a line's quantity              |
| `DELETE` | `/cart/items/:variantId` | Remove a line                      |
| `DELETE` | `/cart`                  | Empty the cart                     |
| `GET`    | `/me/addresses`          | The customer's addresses           |
| `POST`   | `/me/addresses`          | Add one                            |
| `PATCH`  | `/me/addresses/:id`      | Change one                         |
| `DELETE` | `/me/addresses/:id`      | Remove one                         |
| `POST`   | `/orders`                | Check out                          |
| `GET`    | `/orders`                | The customer's orders, cursor page |
| `GET`    | `/orders/:id`            | One order, with items and timeline |
| `POST`   | `/orders/:id/cancel`     | Cancel, while it is still unpaid   |

An order belonging to somebody else answers 404, not 403: the difference between the two would
tell an attacker which order references exist.

### Back office — an `agent` token with the `admin` role

| Method   | Route                                      | What it does                           |
| -------- | ------------------------------------------ | -------------------------------------- |
| `POST`   | `/categories`                              | Create a category                      |
| `PATCH`  | `/categories/:id`                          | Change one                             |
| `DELETE` | `/categories/:id`                          | Remove one, if it holds no product     |
| `POST`   | `/products`                                | Create a product (starts `draft`)      |
| `GET`    | `/products/id/:id`                         | Read a draft, which has no public slug |
| `PATCH`  | `/products/:id`                            | Change or publish a product            |
| `DELETE` | `/products/:id`                            | Archive a product                      |
| `POST`   | `/products/:productId/variants`            | Add a variant                          |
| `PATCH`  | `/products/:productId/variants/:variantId` | Change one (price, stock, …)           |
| `DELETE` | `/products/:productId/variants/:variantId` | Remove one, if never ordered           |
| `POST`   | `/products/:productId/images`              | Upload an image (`multipart`)          |
| `GET`    | `/admin/orders`                            | Every order; `status`, `customerId`    |
| `GET`    | `/admin/orders/:id`                        | Any order                              |
| `POST`   | `/admin/orders/:id/status`                 | Move it through the machine            |
| `POST`   | `/admin/orders/:id/notes`                  | Add a timeline note                    |

Publishing a product without an active variant is refused: an `active` product nobody can buy
is a shop-window with nothing behind the glass. Deleting a variant that has already been
ordered is refused too — deactivate it instead, so the invoices keep pointing at something.

---

## The order state machine

```
pending_payment ──▶ paid ──▶ preparing ──▶ shipped ──▶ delivered
       │             │           │
       └─────────────┴───────────┴──▶ cancelled
```

The transitions live in one table in `order.types.ts`, so an illegal move is rejected
identically wherever it comes from, and adding a state is a one-line change with a
compiler-checked exhaustive key set.

- **There is no way back from `shipped`.** Once a parcel is with a courier the shop no longer
  controls what happens to it, and a cancellation that put the stock back would be a lie.
- **A customer may only cancel, and only while the order is `pending_payment`.** After that the
  shop has money to refund and a parcel to unpack: that is a conversation, not a button.
- **The status change and its timeline entry are one write**, so history can never describe a
  change that did not happen.
- **The write is a compare-and-set** on the status it read. Two agents clicking at the same
  instant do not both win: the second gets a 409 telling it to read the order again.

Timestamps (`paidAt`, `shippedAt`, …) are derived from the status. No client ever sends one.

---

## How the stock is protected

Stock leaves the shelf at **checkout**, not at payment: reserving when the order is placed is
what stops two customers buying the last unit.

The reservation is a single conditional statement per line:

```ts
const reserved = await tx.productVariant.updateMany({
  where: { id: item.variantId, stock: { gte: item.quantity } },
  data: { stock: { decrement: item.quantity } },
});

if (reserved.count === 0) {
  throw new ConflictError(`"${item.productName}" is no longer available in that quantity`);
}
```

Reading the stock and lowering it in one statement is what makes a checkout safe under
concurrency: two checkouts racing for the last unit are serialised by the row lock the `UPDATE`
takes. One matches and buys it; the other matches nothing and is told so, as a clean 409.

A read followed by a write would let both pass, and only the `CHECK (stock >= 0)` constraint
underneath would catch it — as a rolled-back transaction rather than an answer a shopper can
understand. That constraint is still there, as the last line of defence rather than the first.

Verified, not asserted: two simultaneous checkouts for a variant with `stock = 1` produce one
`201`, one `409`, and a final stock of exactly `0`. That race is replayed on every run by
`src/modules/order/order.integration.test.ts`, because an invariant proved once by hand is an
invariant that expires at the next refactoring.

Cancelling before the parcel ships puts the units back in the same transaction that writes the
status — and it reads the quantities from the order's own lines, not from the caller. What was
reserved is what the invoice says.

Every stock check in the **cart** is advisory. It stops a customer filling a cart with something
the shop plainly does not have, but between that check and checkout anything can happen.

---

## Notifications

`NotificationService` is the one entry point to a person. What is fast and local — storing the
in-app row, pushing it over the socket — happens inline; the email is queued, so a mail provider
being down never turns into a failed checkout.

An order sends:

- **to the customer** — an in-app notification and an email, at checkout and at every status
  change. The wording lives in `src/shared/utils-services/locales/{fr,en}.json`.
- **to the back office** — `order.placed` and `order.status-changed` on the socket, broadcast to
  the `role:admin` room. A room, not a list of recipients: whoever is signed in as an admin
  right now sees it, and nobody has to be looked up to make that happen.

The typed event map in `src/shared/realtime/realtime.types.ts` is shared by the server and every
client, so emitting an event the map does not know is a compile error.

In development every email lands in Mailpit (`http://localhost:8026`) instead of a real inbox.

---

## Money

Amounts are integers in **minor units**, never floats and never `Decimal`. `12_900_000` is
129 000 XOF.

Two reasons. A float cannot hold `0.1 + 0.2`, and a `Decimal` is an object: handing one back
from a repository would put a `Decimal.js` instance in the domain, and the rule that no ORM type
crosses the repository boundary exists precisely so that swapping the ORM stays possible.

`MAX_PRICE_CENTS` and `MAX_QUANTITY` are chosen so that `unitPrice × quantity` still fits in a
PostgreSQL `Int`. A cart holds one currency: the first line decides it, and a subtotal made of
two currencies is not a number.

Shipping is a flat fee waived above a threshold, both constants in `order.service.ts`. A real
shop computes it by zone and by weight; what matters is that the customer never sends it.

---

## Project structure

```
src/
  core/            the framework: decorators, DI, database, http, errors, security
  shared/          the kit: cache, lock, queue, mailer, media, realtime, notifications, i18n
  modules/
    auth/          accounts, sessions, MFA, audit
    customer/      delivery addresses
    catalog/       categories, products, variants, images
    cart/          the cart and its live pricing
    order/         checkout, the state machine, the timeline
    health/
prisma/
  schema.prisma      the whole schema
  migrations/        including the hand-written CHECK constraints
scripts/
  seed.ts            the demo shop
  create-admin.ts    the first privileged account
  realtime-watch.ts  print the realtime feed of a signed-in actor
```

Each module is a folder with the same shape:

```
<module>.module.ts                  what to register, and what it refuses to start without
<module>.controller.ts              routes and decorators only
<module>.service.ts                 the rules
<module>.repository.ts              an interface and a token — never an implementation
<module>.schemas.ts                 Zod, one schema per shape
<module>.types.ts                   the domain types
sql/<module>.prisma.repository.ts   the only file that knows Prisma exists
```

A module declares what it needs and refuses to boot without it. The cart says so about the
catalogue; the order module about the cart, the catalogue, the addresses and the notifications —
so a wrong `MODULES_ENABLED` fails at boot with a sentence, instead of on the first checkout
with an unresolvable token.

---

## Configuration

`.env.example` is the reference copy, commented section by section. Every variable is parsed by
Zod at boot: an invalid value **stops the process** naming the offending variable, rather than
starting a server that fails on the first request.

The ones worth knowing here:

| Variable          | Default    | Meaning                                                          |
| ----------------- | ---------- | ---------------------------------------------------------------- |
| `DB_PROVIDER`     | `postgres` | The only accepted value in this project.                         |
| `DATABASE_URL`    | —          | Checked against `DB_PROVIDER`: a Mongo URL is refused at boot.   |
| `MODULES_ENABLED` | `*`        | Comma-separated module names. This is the microservice switch.   |
| `API_PREFIX`      | `/api/v1`  | Mount path shared by every business module.                      |
| `DEFAULT_LOCALE`  | `fr`       | Used by the notification wording.                                |
| `QUEUE_ENABLED`   | `true`     | `false` runs jobs inline — right for tests, wrong in production. |

In production the boot refuses a few more things: a wildcard `CORS_ORIGINS`, a missing realtime
authenticator, secrets that are equal to one another.

---

## Testing

```bash
pnpm test                # everything
pnpm test:unit
pnpm test:integration    # needs the docker stack up
pnpm test:coverage
```

`pnpm typecheck` and `pnpm lint` are part of the definition of done — the lint rules are
type-aware, so they catch things `tsc` alone does not.

"It compiles" proves nothing. Every route in this project was called for real, against a live
Postgres, before the module was called finished — including the failure paths: an illegal
transition, a customer cancelling a paid order, a non-admin reaching `/admin/orders`, checkout
with an empty cart, a quantity above the stock, and two checkouts racing for the last unit.

The ones that guard an invariant rather than a shape are then pinned down in
`src/modules/order/order.integration.test.ts`, which runs the whole purchase journey against the
real database: stock movement, cart emptied in the same transaction, the state machine, the
refund of stock on cancellation, one customer unable to read another's order, and the race for
the last unit.

---

## Scripts

| Script                                 | Purpose                                      |
| -------------------------------------- | -------------------------------------------- |
| `pnpm dev`                             | Run with tsx, reload on change               |
| `pnpm build` / `pnpm start`            | Bundle to `dist/server.js`, then run it      |
| `pnpm typecheck`                       | `tsc --noEmit`                               |
| `pnpm lint` / `pnpm lint:fix`          | ESLint, type-aware                           |
| `pnpm format` / `pnpm format:check`    | Prettier                                     |
| `pnpm test` / `:unit` / `:integration` | Vitest                                       |
| `pnpm db:migrate`                      | Create and apply a migration (development)   |
| `pnpm db:deploy`                       | Apply pending migrations (CI, production)    |
| `pnpm db:seed`                         | Fill an empty database with the demo shop    |
| `pnpm db:studio`                       | Prisma Studio                                |
| `pnpm admin:create`                    | Create or promote an account with `admin`    |
| `pnpm realtime:watch`                  | Print the realtime feed of a signed-in actor |

---

## Security summary

- **Everything is closed by default.** A route is protected unless it carries `@Public()`. The
  storefront reads are the only public ones.
- **Roles come from the token, never from the body.** Registration produces a role-less
  `customer`; only `pnpm admin:create` or another admin can grant a role.
- **No id in a path that the token already answers.** The cart and the addresses are derived
  from the principal, so there is no id to tamper with.
- **Scoped reads.** An order, an address or a cart that is not yours reads exactly like one that
  does not exist.
- **Passwords** are argon2id. Access tokens are short-lived; refresh tokens rotate and are
  revoked as a family on reuse.
- **The rate limiter is backed by Redis**, so the quota is shared across instances rather than
  multiplied by them.
- **Uploads are validated by their magic bytes**, not by a Content-Type header the client chose.
- **The database is the last line of defence**: `CHECK (stock >= 0)`, `CHECK (quantity > 0)`,
  positive-amount constraints, and a `RESTRICT` on the variant an order line points at.
- **Request ids** in every log line, every response body and the `x-request-id` header.
