/**
 * tax-calculator's side of the destination / jurisdiction-key parity (SB3-238, ADR-012).
 *
 * order-syncer binds each calculation reference to the order before filing it, using copies of
 * extractCustomerAddress and createAddressKey (the two modules share no code, ADR-011). The parity
 * fixture is vendored once per module (`<module>/test-fixtures/jurisdiction-parity.json`) because
 * commercetools Connect bundles each application in isolation, so a single repo-root file would not
 * ship with either bundle and the suite could not run under `connect validate`. The two copies are
 * pinned identical by PARITY_FIXTURE_SHA256 below — the same constant in order-syncer's spec — so a
 * drift in either copy fails that module's suite before it can turn into legitimate filings refused
 * at order time. Change a copy, and you must update the hash here and in order-syncer, which forces
 * the other copy to match.
 */
import { createHash } from 'node:crypto';
import { expect, describe, it, jest } from '@jest/globals';
import parity from '../../../test-fixtures/jurisdiction-parity.json';

// Shared with order-syncer/test/unit/validators/jurisdiction-parity.spec.js. Over the parsed content
// (data, not whitespace), so the two module copies are pinned to the same data regardless of format.
const PARITY_FIXTURE_SHA256 = '01cdf36af1975e828ea78ff84f114bf15e91b7a15a1431dbdea736df9890465f';

jest.mock('../../../src/utils/logger.utils.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));
jest.mock('../../../src/clients/stripe.client.js', () => ({
  createStripeClient: jest.fn()
}));
jest.mock('../../../src/services/tax-code.service.js', () => ({
  __esModule: true,
  default: { getTaxCodeForProduct: jest.fn(() => 'txcd_99999999') }
}));

import { TaxOrchestratorService } from '../../../src/services/tax-orchestrator.service.js';

const jurisdictionOf = (a) => ({ country: a?.country, state: a?.state, city: a?.city, postal_code: a?.postal_code });

describe('jurisdiction parity with order-syncer — tax-calculator side', () => {
  const service = new TaxOrchestratorService();

  it('fixture matches the shared hash (same copy as order-syncer)', () => {
    const hash = createHash('sha256').update(JSON.stringify(parity)).digest('hex');
    expect(hash).toBe(PARITY_FIXTURE_SHA256);
  });

  it.each(parity.keys.map((c) => [c.name, c]))('key: %s', (_name, c) => {
    expect(service.createAddressKey(c.address)).toBe(c.key);
  });

  it.each(parity.destinations.map((c) => [c.name, c]))('destination: %s', (_name, c) => {
    const cart = c.resource;
    const shipping = c.shippingKey ? cart.shipping.find((s) => s.shippingKey === c.shippingKey) : null;
    const address = service.extractCustomerAddress(cart, shipping);
    expect(jurisdictionOf(address)).toEqual(jurisdictionOf(c.expected));
  });

  // The stamp names order-syncer binds on (calculation-binding.validators.js). Renaming or dropping
  // one here, even with this module's own tests updated, fails this case.
  describe('stamps: the request builders write the shared names on every line item', () => {
    const lineItem = {
      id: 'li-1',
      productId: 'p-1',
      quantity: 2,
      totalPrice: { centAmount: 2000, currencyCode: 'USD' },
      shippingDetails: { targets: [{ shippingMethodKey: 'k1', quantity: 2 }] }
    };
    const cart = {
      id: 'cart-1',
      shippingMode: 'Single',
      shippingAddress: { country: 'US', state: 'CA', city: 'Los Angeles', postalCode: '90012' },
      totalPrice: { currencyCode: 'USD', centAmount: 2000 },
      lineItems: [lineItem]
    };

    it('Multiple mode: cart id and shipping key', () => {
      const data = service.buildLineItemForShippingMethod({ ...cart, shippingMode: 'Multiple' }, lineItem, 'k1', {}, new Map());
      expect(data.metadata[parity.stamps.cart]).toBe('cart-1');
      expect(data.metadata[parity.stamps.shipping]).toBe('k1');
    });

    it('Single mode: cart id', async () => {
      jest.spyOn(service, 'getShippingCostForGroup').mockResolvedValue(null);
      const request = await service.createSingleRequestForGroup({ lineItems: [lineItem] }, cart, {}, new Map());
      expect(request.line_items).toHaveLength(1);
      expect(request.line_items[0].metadata[parity.stamps.cart]).toBe('cart-1');
    });
  });
});
