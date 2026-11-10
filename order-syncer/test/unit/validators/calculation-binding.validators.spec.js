import { expect, describe, it, jest, beforeEach } from '@jest/globals';

jest.mock('../../../src/utils/logger.util.js', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() }
}));
jest.mock('../../../src/extensions/stripe/clients/client.js', () => ({
  retrieveCalculation: jest.fn()
}));

import { logger } from '../../../src/utils/logger.util.js';
import { retrieveCalculation } from '../../../src/extensions/stripe/clients/client.js';
import { partitionReferencesByOrderBinding } from '../../../src/validators/calculation-binding.validators.js';

// Stripe echoes `postal_code`; commercetools uses `postalCode`.
const LA_STRIPE = { country: 'US', state: 'CA', city: 'Los Angeles', postal_code: '90012' };
const LA_CT = { country: 'US', state: 'CA', city: 'Los Angeles', postalCode: '90012' };
const SF_CT = { country: 'US', state: 'CA', city: 'San Francisco', postalCode: '94102' };

const calcFor = (cartId, address, shippingKey) => ({
  customer_details: { address },
  line_items: { data: [{ metadata: { cartId, shippingKey } }] }
});

const order = (overrides = {}) => ({
  id: 'order-1',
  cart: { id: 'cart-1' },
  shippingMode: 'Single',
  shippingAddress: LA_CT,
  ...overrides
});

describe('partitionReferencesByOrderBinding', () => {
  beforeEach(() => jest.clearAllMocks());

  it('accepts a reference whose calculation belongs to the cart and matches the delivery address', async () => {
    retrieveCalculation.mockResolvedValue(calcFor('cart-1', LA_STRIPE));
    const r = await partitionReferencesByOrderBinding(['taxcalc_1'], order());
    expect(r.valid).toEqual(['taxcalc_1']);
    expect(r.invalid).toEqual([]);
  });

  it('rejects a reference to another cart (cartId mismatch)', async () => {
    retrieveCalculation.mockResolvedValue(calcFor('another-cart', LA_STRIPE));
    const r = await partitionReferencesByOrderBinding(['taxcalc_1'], order());
    expect(r.valid).toEqual([]);
    expect(r.invalid).toEqual([{ ref: 'taxcalc_1', reason: 'cartId-mismatch' }]);
  });

  it('rejects a same-cart reference made for another address (address mismatch)', async () => {
    retrieveCalculation.mockResolvedValue(calcFor('cart-1', { country: 'US', state: 'CA', city: 'San Francisco', postal_code: '94102' }));
    const r = await partitionReferencesByOrderBinding(['taxcalc_1'], order()); // order ships to LA
    expect(r.invalid).toEqual([{ ref: 'taxcalc_1', reason: 'address-mismatch' }]);
  });

  it('matches against the shipping method address in Multiple mode', async () => {
    const o = order({
      shippingMode: 'Multiple',
      shippingAddress: undefined,
      shipping: [{ shippingKey: 'k1', shippingAddress: LA_CT }, { shippingKey: 'k2', shippingAddress: SF_CT }]
    });
    retrieveCalculation.mockResolvedValue(calcFor('cart-1', LA_STRIPE, 'k1'));
    const r = await partitionReferencesByOrderBinding(['taxcalc_1'], o);
    expect(r.valid).toEqual(['taxcalc_1']);
  });

  it('rejects a Multiple-mode calculation made for the wrong shipping method address', async () => {
    const o = order({
      shippingMode: 'Multiple',
      shippingAddress: undefined,
      shipping: [{ shippingKey: 'k1', shippingAddress: LA_CT }, { shippingKey: 'k2', shippingAddress: SF_CT }]
    });
    // calc for k2 (San Francisco) but stamped with k1 → compared against LA → mismatch
    retrieveCalculation.mockResolvedValue(calcFor('cart-1', { country: 'US', state: 'CA', city: 'San Francisco', postal_code: '94102' }, 'k1'));
    const r = await partitionReferencesByOrderBinding(['taxcalc_1'], o);
    expect(r.invalid).toEqual([{ ref: 'taxcalc_1', reason: 'address-mismatch' }]);
  });

  const stripeError = (props) => Object.assign(new Error(props.message || 'stripe error'), props);

  it('flags a reference whose calculation does not exist (resource_missing / 404)', async () => {
    retrieveCalculation.mockRejectedValue(stripeError({ code: 'resource_missing', statusCode: 404, message: 'No such tax calculation' }));
    const r = await partitionReferencesByOrderBinding(['taxcalc_1'], order());
    expect(r.invalid).toEqual([{ ref: 'taxcalc_1', reason: 'calculation-not-found' }]);
  });

  it('flags a reference the provider rejects permanently (a non-404 4xx)', async () => {
    retrieveCalculation.mockRejectedValue(stripeError({ statusCode: 400, message: 'Invalid request' }));
    const r = await partitionReferencesByOrderBinding(['taxcalc_1'], order());
    expect(r.invalid).toEqual([{ ref: 'taxcalc_1', reason: 'retrieve-rejected' }]);
  });

  it.each([
    ['a provider 5xx', { statusCode: 503, message: 'Service unavailable' }],
    ['a rate limit (429)', { statusCode: 429, message: 'Too many requests' }],
    ['a lock conflict (409)', { statusCode: 409, message: 'Lock timeout' }],
    ['a network failure (no status)', { message: 'socket hang up' }],
  ])('re-throws %s instead of judging the reference, so the message is redelivered', async (_name, props) => {
    retrieveCalculation.mockRejectedValue(stripeError(props));
    await expect(partitionReferencesByOrderBinding(['taxcalc_1'], order())).rejects.toMatchObject(props);
  });

  it('re-throws a transient failure even after an earlier reference was judged (nothing is filed yet)', async () => {
    retrieveCalculation
      .mockResolvedValueOnce(calcFor('cart-1', LA_STRIPE))
      .mockRejectedValueOnce(stripeError({ statusCode: 500, message: 'Internal error' }));
    await expect(partitionReferencesByOrderBinding(['taxcalc_ok', 'taxcalc_2'], order())).rejects.toMatchObject({ statusCode: 500 });
  });

  // SB3-238 round 4: a rejected API key is a fault of the integration, not of the reference — it is
  // redelivered (answered 500 with a fixed message, so Stripe's text is not sent back) and logged as
  // a credentials failure, never as "does not belong to this order".
  it.each([401, 403])('re-throws a %s as a credentials failure to redeliver, never judging the reference', async (status) => {
    retrieveCalculation.mockRejectedValue(stripeError({ statusCode: status, message: 'Invalid API Key provided' }));
    await expect(partitionReferencesByOrderBinding(['taxcalc_1'], order())).rejects.toMatchObject({
      statusCode: 500,
      message: 'Stripe refused the API key or its permissions while checking calculation references'
    });
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining(`(${status})`));
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('credentials'));
  });

  // SB3-238 round 4: a verdict about the reference keeps why the provider gave it, so a key or
  // account problem cannot read as forged references.
  it.each([
    ['not found', { statusCode: 404, code: 'resource_missing', message: 'No such tax calculation' }, 'calculation-not-found', '(404, resource_missing)'],
    ['rejected', { statusCode: 400, message: 'Invalid request' }, 'retrieve-rejected', '(400)'],
  ])('logs the provider status and message when the retrieve is %s', async (_name, props, reason, statusText) => {
    retrieveCalculation.mockRejectedValue(stripeError(props));
    const r = await partitionReferencesByOrderBinding(['taxcalc_1'], order());
    expect(r.invalid).toEqual([{ ref: 'taxcalc_1', reason }]);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining(statusText));
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining(props.message));
  });

  // SB3-238 round 4: a malformed id is refused before any provider call. Retrieved, it could make the
  // SDK throw a status-less local error (a URIError on a lone surrogate), read as transient, and
  // redeliver the order forever — blocking its valid references.
  it.each([
    ['empty', ''],
    ['a lone surrogate', 'taxcalc_\uD800'],
    ['a path separator', 'taxcalc/x'],
    ['longer than 255 characters', 'a'.repeat(256)],
    ['a line break (a forged log line)', 'taxcalc_1\nOrder other: needs manual filing'],
    ['a Unicode line separator', 'taxcalc_1 Order other: needs manual filing'],
    ['not a string', 42],
  ])('refuses a malformed reference (%s) without retrieving it, and the order\'s valid one still binds', async (_name, bad) => {
    retrieveCalculation.mockResolvedValue(calcFor('cart-1', LA_STRIPE));
    const r = await partitionReferencesByOrderBinding([bad, 'taxcalc_ok'], order());
    expect(retrieveCalculation).toHaveBeenCalledTimes(1);
    expect(retrieveCalculation).toHaveBeenCalledWith('taxcalc_ok');
    expect(r.valid).toEqual(['taxcalc_ok']);
    expect(r.invalid).toHaveLength(1);
    expect(r.invalid[0].reason).toBe('reference-malformed');
    expect(r.invalid[0].ref).toMatch(/^[\x20-\x7e]*$/);
    expect(r.invalid[0].ref.length).toBeLessThanOrEqual(80);
  });

  describe('Multiple mode: the shipping method the calculation was made for', () => {
    const multiple = order({
      shippingMode: 'Multiple',
      shippingAddress: LA_CT, // an order-level address: must never stand in for a shipment's
      shipping: [{ shippingKey: 'k2', shippingAddress: SF_CT }]
    });

    it('refuses a calculation whose shippingKey names no shipment of the order (never falls back to the order-level address)', async () => {
      // Made for a shipping method (k1, Los Angeles) the order no longer has; the order-level
      // shippingAddress is Los Angeles too, so a fallback to it would wrongly bind (R-179).
      retrieveCalculation.mockResolvedValue(calcFor('cart-1', LA_STRIPE, 'k1'));
      const r = await partitionReferencesByOrderBinding(['taxcalc_1'], multiple);
      expect(r.valid).toEqual([]);
      expect(r.invalid).toEqual([{ ref: 'taxcalc_1', reason: 'shipping-key-unknown' }]);
    });

    it('refuses a calculation whose line items carry no shippingKey', async () => {
      retrieveCalculation.mockResolvedValue(calcFor('cart-1', LA_STRIPE, undefined));
      const r = await partitionReferencesByOrderBinding(['taxcalc_1'], multiple);
      expect(r.invalid).toEqual([{ ref: 'taxcalc_1', reason: 'shipping-key-missing' }]);
    });

    it('refuses a calculation whose line items carry different shippingKeys', async () => {
      retrieveCalculation.mockResolvedValue({
        customer_details: { address: { country: 'US', state: 'CA', city: 'San Francisco', postal_code: '94102' } },
        line_items: { data: [{ metadata: { cartId: 'cart-1', shippingKey: 'k2' } }, { metadata: { cartId: 'cart-1', shippingKey: 'k1' } }] }
      });
      const r = await partitionReferencesByOrderBinding(['taxcalc_1'], multiple);
      expect(r.invalid).toEqual([{ ref: 'taxcalc_1', reason: 'shipping-key-mixed' }]);
    });
  });

  it('binds a calculation of an order with no delivery address to its country (ADR-007 fallback)', async () => {
    // tax-calculator sends { country: cart.country } when there is no delivery address; Stripe echoes
    // the country with null subfields (R-188).
    retrieveCalculation.mockResolvedValue(calcFor('cart-1', { country: 'US', state: null, city: null, postal_code: null, line1: null }));
    const r = await partitionReferencesByOrderBinding(['taxcalc_1'], order({ shippingAddress: undefined, country: 'US' }));
    expect(r.valid).toEqual(['taxcalc_1']);
  });

  it('refuses a country-only calculation when the order does have a delivery address', async () => {
    retrieveCalculation.mockResolvedValue(calcFor('cart-1', { country: 'US', state: null, city: null, postal_code: null }));
    const r = await partitionReferencesByOrderBinding(['taxcalc_1'], order({ country: 'US' })); // ships to LA
    expect(r.invalid).toEqual([{ ref: 'taxcalc_1', reason: 'address-mismatch' }]);
  });

  it('rejects when the order has no cart reference to bind against', async () => {
    retrieveCalculation.mockResolvedValue(calcFor('cart-1', LA_STRIPE));
    const r = await partitionReferencesByOrderBinding(['taxcalc_1'], order({ cart: undefined }));
    expect(r.invalid).toEqual([{ ref: 'taxcalc_1', reason: 'order-has-no-cart-reference' }]);
  });

  it('rejects a calculation with no line items (cannot verify ownership)', async () => {
    retrieveCalculation.mockResolvedValue({ customer_details: { address: LA_STRIPE }, line_items: { data: [] } });
    const r = await partitionReferencesByOrderBinding(['taxcalc_1'], order());
    expect(r.invalid).toEqual([{ ref: 'taxcalc_1', reason: 'cartId-mismatch' }]);
  });

  it('partitions a mix: the order\'s own reference is kept, the appended foreign one is dropped', async () => {
    retrieveCalculation
      .mockResolvedValueOnce(calcFor('cart-1', LA_STRIPE))        // taxcalc_mine
      .mockResolvedValueOnce(calcFor('other-cart', LA_STRIPE));   // taxcalc_foreign (appended)
    const r = await partitionReferencesByOrderBinding(['taxcalc_mine', 'taxcalc_foreign'], order());
    expect(r.valid).toEqual(['taxcalc_mine']);
    expect(r.invalid).toEqual([{ ref: 'taxcalc_foreign', reason: 'cartId-mismatch' }]);
  });
});
