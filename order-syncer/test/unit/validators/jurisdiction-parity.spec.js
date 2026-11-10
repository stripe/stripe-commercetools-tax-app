/**
 * order-syncer's side of the destination / jurisdiction-key parity (SB3-238, ADR-012).
 *
 * order-syncer holds copies of tax-calculator's extractCustomerAddress and createAddressKey (the two
 * modules share no code, ADR-011). The parity fixture is vendored once per module
 * (`<module>/test-fixtures/jurisdiction-parity.json`) because commercetools Connect bundles each
 * application in isolation, so a single repo-root file would not ship with either bundle and the
 * suite could not run under `connect validate`. The two copies are pinned identical by
 * PARITY_FIXTURE_SHA256 below — the same constant in tax-calculator's spec — so if either copy drifts,
 * that module's suite fails before the drift turns into legitimate filings refused at order time.
 */
import { createHash } from 'node:crypto';
import { expect, describe, it, jest } from '@jest/globals';
import parity from '../../../test-fixtures/jurisdiction-parity.json';

// Shared with tax-calculator/test/unit/services/jurisdiction-parity.spec.js. Over the parsed content
// (data, not whitespace), so the two module copies are pinned to the same data regardless of format.
const PARITY_FIXTURE_SHA256 = '01cdf36af1975e828ea78ff84f114bf15e91b7a15a1431dbdea736df9890465f';

jest.mock('../../../src/utils/logger.util.js', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() }
}));
jest.mock('../../../src/extensions/stripe/clients/client.js', () => ({
  retrieveCalculation: jest.fn()
}));

import { retrieveCalculation } from '../../../src/extensions/stripe/clients/client.js';
import {
  jurisdictionKey,
  orderDestinationForCalculation,
  partitionReferencesByOrderBinding
} from '../../../src/validators/calculation-binding.validators.js';

const jurisdictionOf = (a) => ({ country: a?.country, state: a?.state, city: a?.city, postal_code: a?.postal_code });

// Line-item metadata written under the stamp names the fixture shares with tax-calculator.
const stamped = (cartId, shippingKey) => ({
  [parity.stamps.cart]: cartId,
  ...(shippingKey ? { [parity.stamps.shipping]: shippingKey } : {})
});

describe('jurisdiction parity with tax-calculator — order-syncer side', () => {
  it('fixture matches the shared hash (same copy as tax-calculator)', () => {
    const hash = createHash('sha256').update(JSON.stringify(parity)).digest('hex');
    expect(hash).toBe(PARITY_FIXTURE_SHA256);
  });

  it.each(parity.keys.map((c) => [c.name, c]))('key: %s', (_name, c) => {
    expect(jurisdictionKey(c.address)).toBe(c.key);
  });

  it.each(parity.destinations.map((c) => [c.name, c]))('destination: %s', (_name, c) => {
    const calculation = { line_items: { data: [{ metadata: stamped('cart-1', c.shippingKey) }] } };
    const result = orderDestinationForCalculation(c.resource, calculation);
    expect(result.reason).toBeUndefined();
    expect(jurisdictionOf(result.address)).toEqual(jurisdictionOf(c.expected));
  });

  // The stamp names: if tax-calculator renamed one, its side of this fixture fails; if order-syncer
  // read another name, this case fails — before legitimate references are refused in production.
  it.each(parity.destinations.map((c) => [c.name, c]))('stamps: binds a calculation stamped with the shared names — %s', async (_name, c) => {
    const resource = { id: 'order-1', cart: { id: 'cart-1' }, ...c.resource };
    retrieveCalculation.mockResolvedValue({
      customer_details: { address: c.expected },
      line_items: { data: [{ metadata: stamped('cart-1', c.shippingKey) }] }
    });
    const r = await partitionReferencesByOrderBinding(['taxcalc_1'], resource);
    expect(r).toEqual({ valid: ['taxcalc_1'], invalid: [] });
  });
});
