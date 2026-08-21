import { ForbiddenError } from '@core/errors/app-error';
import { requestContext } from '@core/http/request-context';

/** The actor type that shops. The back office runs under `agent` and never owns a cart. */
export const CUSTOMER_ACTOR_TYPE = 'customer';

/**
 * The signed-in customer, or a refusal.
 *
 * An account is `(actorType, email)`, so the same address can hold an agent account and a
 * customer account and the guard alone does not tell them apart — it only proves the token is
 * valid. Every route that owns customer data goes through here, which is what stops an agent's
 * token from silently creating a cart or an address under an id no shopper will ever use.
 */
export function requireCustomerId(): string {
  const principal = requestContext.requirePrincipal();

  if (principal.actorType !== CUSTOMER_ACTOR_TYPE) {
    throw new ForbiddenError('This endpoint is for customer accounts');
  }

  return principal.id;
}
