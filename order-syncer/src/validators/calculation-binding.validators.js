import { logger } from '../utils/logger.util.js';
import { retrieveCalculation } from '../extensions/stripe/clients/client.js';
import CustomError from '../errors/custom.error.js';
import { HTTP_STATUS_SERVER_ERROR } from '../constants/http.status.constants.js';

/**
 * Bind the order's stored calculation references to the order before they are filed.
 *
 * `connectorStripeTax_calculationReferences` is a shopper-writable cart custom field, copied to the
 * order; `order-syncer` files every reference it holds. Without a check at filing time, a reference
 * that a shopper appended or forged is filed as this order's Stripe Tax compliance transaction — the
 * concealment step of the SB3-238 report (the cart-side guard only checks the reference re-apply
 * reads). This verifies, per reference, that the Stripe calculation it names:
 *   1. was made for THIS order's cart — every line item carries the order's cart id in metadata; and
 *   2. was made for the order's delivery destination — its own customer_details.address has the same
 *      jurisdiction key as the destination tax-calculator would have sent for it (Multiple-shipping
 *      orders have one calculation per shipping method, each for its own address).
 * (SB3-238 AC-5; ADR-012 Sweep result.)
 *
 * Two definitions here are COPIES of tax-calculator's, because the two modules share no code
 * (ADR-011): `jurisdictionKey` copies `TaxOrchestratorService.createAddressKey`, and
 * `orderDestinationForCalculation` copies `TaxOrchestratorService.extractCustomerAddress`. Both pairs
 * are held in step by a parity fixture vendored once per module
 * (`<module>/test-fixtures/jurisdiction-parity.json`, the two copies pinned identical by a shared
 * SHA-256 both suites assert), which each module's own suite runs against its own functions, together
 * with the names of the line-item stamps read here (`stamps` section). Change both sides and the
 * fixtures together.
 */

// A Stripe object id: letters, digits and underscore, at most 255 characters. Checked before the
// retrieve, so a malformed value can never make the SDK throw a status-less local error (which
// would read as transient and redeliver forever).
const WELL_FORMED_REFERENCE = /^[A-Za-z0-9_]{1,255}$/;

const normalise = (value) => (value == null ? null : String(value).trim().toUpperCase());
// Postal codes differ by internal spacing between sources; collapse all whitespace.
const normalisePostal = (value) => (value == null ? null : String(value).replace(/\s+/g, '').toUpperCase());

/**
 * Jurisdiction key of a Stripe-shaped address (`postal_code`): country + state + city + postal code,
 * normalised. Copy of tax-calculator's `createAddressKey` for a present address.
 * @param {object} address - A Stripe-shaped address.
 * @returns {string} The key.
 */
export function jurisdictionKey(address) {
  return JSON.stringify({
    country: normalise(address?.country),
    state: normalise(address?.state),
    city: normalise(address?.city),
    postal_code: normalisePostal(address?.postal_code)
  });
}

/**
 * The destination tax-calculator sent to Stripe for this calculation, rebuilt from the order.
 * Copy of tax-calculator's `extractCustomerAddress`:
 *   - Single: the order's delivery address;
 *   - Multiple: the delivery address of the shipping method the calculation was made for, named by
 *     the `shippingKey` tax-calculator stamps on every line item. A calculation whose line items carry
 *     no key, or different keys, or a key the order has no shipping entry for, was not made for any of
 *     this order's shipments, and is refused — never compared with an order-level address;
 *   - no delivery address at all: the country only, from `order.country` (ADR-007's fallback).
 * @param {object} order - The commercetools order.
 * @param {object} calculation - The retrieved Stripe Tax calculation (line_items expanded).
 * @returns {{address: object}|{reason: string}} The Stripe-shaped destination, or why there is none.
 */
export function orderDestinationForCalculation(order, calculation) {
  let deliveryAddress = {};

  if (order?.shippingMode === 'Single') {
    deliveryAddress = order.shippingAddress || {};
  } else if (order?.shippingMode === 'Multiple') {
    const resolved = multipleShippingDeliveryAddress(order, calculation);
    if (resolved.reason) {
      return { reason: resolved.reason };
    }
    deliveryAddress = resolved.address;
  }

  return {
    address: {
      country: deliveryAddress.country || order?.country,
      state: deliveryAddress.state,
      city: deliveryAddress.city,
      postal_code: deliveryAddress.postalCode
    }
  };
}

/**
 * Multiple-shipping delivery address for the shipment a calculation was made for, named by the
 * `shippingKey` tax-calculator stamps on every line item. Auxiliary of
 * `orderDestinationForCalculation` above.
 * @param {object} order - The commercetools order.
 * @param {object} calculation - The retrieved Stripe Tax calculation (line_items expanded).
 * @returns {{address: object}|{reason: string}} The delivery address, or why the calculation is not
 *   bound to one of this order's shipments.
 */
function multipleShippingDeliveryAddress(order, calculation) {
  const keys = new Set((calculation?.line_items?.data ?? []).map((li) => li.metadata?.shippingKey));
  const [shippingKey] = keys;
  if (keys.size !== 1 || !shippingKey) {
    return { reason: keys.size > 1 ? 'shipping-key-mixed' : 'shipping-key-missing' };
  }
  const shipping = Array.isArray(order.shipping) ? order.shipping : [];
  const entry = shipping.find((s) => s.shippingKey === shippingKey);
  if (!entry) {
    return { reason: 'shipping-key-unknown' };
  }
  return { address: entry.shippingAddress || shipping[0]?.shippingAddress || {} };
}

/**
 * Split the order's calculation references into those that belong to the order and those that do not.
 *
 * A reference that is not a well-formed Stripe id is refused before any provider call
 * (`reference-malformed`), and only an escaped preview of it is kept. A missing calculation or any
 * other permanent 4xx is a verdict about the reference, logged with the provider's status and
 * message. Two failures are NOT verdicts about the reference, and are re-thrown so the message is
 * answered with an error status and Pub/Sub redelivers it (order-sync.md Rules 5 and 11):
 *   - a transient failure (no status, 409, 429, 5xx), re-thrown as it is;
 *   - a rejected API key or permission (401, 403), logged at error level as a credentials failure
 *     and re-thrown as a 500 with a fixed message, so the provider's text is not sent back.
 * Nothing has been filed at that point, so the redelivery starts clean.
 *
 * The per-reference work is split into auxiliaries below: `retrieveForBinding` (fetch + error
 * classification, may throw), and `bindingReason` (the cart-and-destination checks on a fetched
 * calculation).
 *
 * @param {Array<string>} calculationReferences - The order's stored references.
 * @param {object} order - The commercetools order (with `cart`, `country`, `shippingAddress`/`shipping`).
 * @returns {Promise<{valid: Array<string>, invalid: Array<{ref: string, reason: string}>}>}
 * @throws The provider error, when a retrieve fails transiently; a 500 `CustomError` on 401/403.
 */
export async function partitionReferencesByOrderBinding(calculationReferences, order) {
  const cartId = order?.cart?.id;
  const valid = [];
  const invalid = [];

  for (const ref of calculationReferences) {
    if (typeof ref !== 'string' || !WELL_FORMED_REFERENCE.test(ref)) {
      invalid.push({ ref: malformedReferencePreview(ref), reason: 'reference-malformed' });
      continue;
    }

    const retrieved = await retrieveForBinding(ref, order);
    if (retrieved.reason) {
      invalid.push({ ref, reason: retrieved.reason });
      continue;
    }

    const reason = bindingReason(retrieved.calculation, order, cartId);
    if (reason) {
      invalid.push({ ref, reason });
    } else {
      valid.push(ref);
    }
  }

  return { valid, invalid };
}

/**
 * Escaped preview of a shopper-written, malformed reference. Auxiliary of
 * `partitionReferencesByOrderBinding`: the value is never retrieved or filed, so only a preview is
 * kept, escaped to printable ASCII (line and paragraph separators included) so it cannot break the
 * log line where it is printed (`sync.controller.js`), and cut after escaping so no character is split.
 * @param {*} ref - The malformed reference value.
 * @returns {string} The escaped preview, at most 80 characters.
 */
function malformedReferencePreview(ref) {
  return JSON.stringify(String(ref))
    .replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
    .slice(0, 80);
}

/**
 * Retrieve a calculation for binding, classifying any failure. Auxiliary of
 * `partitionReferencesByOrderBinding`.
 * @param {string} ref - The well-formed calculation reference.
 * @param {object} order - The commercetools order (for the log context).
 * @returns {Promise<{calculation: object}|{reason: string}>} The calculation, or a verdict reason for
 *   a missing / permanently-rejected reference.
 * @throws The provider error on a transient failure; a 500 `CustomError` on a rejected key (401/403).
 */
async function retrieveForBinding(ref, order) {
  try {
    return { calculation: await retrieveCalculation(ref) };
  } catch (error) {
    const status = error?.statusCode;
    if (status === 401 || status === 403) {
      logger.error(`Order ${order?.id}: Stripe refused the API key (${status}) retrieving calculation ${ref} — a credentials or permissions failure, not a foreign reference; the message will be redelivered: ${error.message}`);
      throw new CustomError(HTTP_STATUS_SERVER_ERROR, 'Stripe refused the API key or its permissions while checking calculation references');
    }
    const missing = isMissing(error);
    if (!missing && isTransient(error)) {
      logger.warn(`Order ${order?.id}: transient failure retrieving calculation ${ref} (${status ?? 'no status'}); the message will be redelivered: ${error.message}`);
      throw error;
    }
    logger.error(`Order ${order?.id}: could not retrieve calculation ${ref} (${status ?? 'no status'}${error?.code ? `, ${error.code}` : ''}): ${error.message}`);
    return { reason: missing ? 'calculation-not-found' : 'retrieve-rejected' };
  }
}

/**
 * Why a retrieved calculation does not bind to the order, or null when it does. Auxiliary of
 * `partitionReferencesByOrderBinding`: the cart-ownership and delivery-destination checks on a
 * calculation that was fetched successfully.
 * @param {object} calculation - The retrieved Stripe Tax calculation (line_items expanded).
 * @param {object} order - The commercetools order.
 * @param {string|undefined} cartId - The order's cart id.
 * @returns {string|null} The reason the calculation does not belong to the order, or null.
 */
function bindingReason(calculation, order, cartId) {
  const lineItems = calculation?.line_items?.data ?? [];
  if (!cartId) {
    return 'order-has-no-cart-reference';
  }
  if (lineItems.length === 0 || !lineItems.every((li) => li.metadata?.cartId === cartId)) {
    return 'cartId-mismatch';
  }
  const destination = orderDestinationForCalculation(order, calculation);
  if (destination.reason) {
    return destination.reason;
  }
  if (jurisdictionKey(calculation?.customer_details?.address) !== jurisdictionKey(destination.address)) {
    return 'address-mismatch';
  }
  return null;
}

/**
 * Whether a provider error means the calculation does not exist (a permanent answer about this
 * reference), as opposed to a failure that may pass on a retry. Auxiliary of `retrieveForBinding`.
 * @param {Error} error - The error thrown by the retrieve.
 * @returns {boolean} True when the calculation is missing.
 */
function isMissing(error) {
  return error?.code === 'resource_missing' || error?.statusCode === 404;
}

/**
 * Whether a provider error is transient: no HTTP status (network, timeout), rate limited, a lock
 * conflict, or a provider-side failure. Any other 4xx is a permanent answer about the reference.
 * Auxiliary of `retrieveForBinding`.
 * @param {Error} error - The error thrown by the retrieve.
 * @returns {boolean} True when a redelivery may succeed.
 */
function isTransient(error) {
  const status = error?.statusCode;
  return status == null || status === 409 || status === 429 || status >= 500;
}
