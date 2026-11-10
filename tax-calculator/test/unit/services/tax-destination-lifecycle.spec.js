/**
 * SB3-238 / AC-6 — verify-full-lifecycle.
 *
 * A calculation the connector actually makes and stores for one jurisdiction must not be replayed
 * when the cart later delivers to another. Unlike `tax-destination-guard.spec.js`, this drives the
 * REAL `TaxOrchestratorService` **and** the REAL `UpdateActionService`, mocking only the Stripe
 * client and the peripheral commercetools lookups — the reporter's PoC strategy. The two phases are
 * genuinely linked: phase 2 is fed exactly what phase 1 produced (the `setCustomType` the connector
 * wrote), and `retrieve` returns the calculation phase 1 made (its `customer_details.address` is the
 * address phase 1 actually sent to Stripe).
 */
import { expect, describe, it, jest, beforeEach } from '@jest/globals';
import { TaxOrchestratorService } from '../../../src/services/tax-orchestrator.service.js';

jest.mock('../../../src/utils/logger.utils.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));
jest.mock('../../../src/clients/stripe.client.js', () => ({ createStripeClient: jest.fn() }));
jest.mock('../../../src/services/ship-from.service.js', () => ({
  __esModule: true, default: { resolveAllShipFromAddresses: jest.fn() }
}));
jest.mock('../../../src/services/tax-behavior.service.js', () => ({
  taxBehaviorService: { determineTaxBehaviorForCart: jest.fn(), logBehaviorDecision: jest.fn() }
}));
jest.mock('../../../src/services/category.service.js', () => ({
  __esModule: true, default: { getCategoriesForProducts: jest.fn() }
}));
jest.mock('../../../src/services/tax-code.service.js', () => ({
  __esModule: true, default: { getTaxCodeForProduct: jest.fn(), getShippingTaxCodeFromShippingInfo: jest.fn() }
}));
// update-action.service.js is deliberately REAL here.

import { createStripeClient } from '../../../src/clients/stripe.client.js';
import shipFromService from '../../../src/services/ship-from.service.js';
import { taxBehaviorService } from '../../../src/services/tax-behavior.service.js';
import categoryService from '../../../src/services/category.service.js';
import taxCodeService from '../../../src/services/tax-code.service.js';

const PORTLAND_OR = { country: 'US', state: 'OR', city: 'Portland', postalCode: '97201', streetName: '123 SW Oak St' };
const LOS_ANGELES_CA = { country: 'US', state: 'CA', city: 'Los Angeles', postalCode: '90012', streetName: '200 N Spring St' };

/** A realistically-shaped Stripe tax calculation, so the real UpdateActionService can build actions. */
const calcFor = (id, address, taxTotal) => ({
  id,
  currency: 'usd',
  amount_total: 10000 + taxTotal,
  tax_amount_exclusive: taxTotal,
  tax_amount_inclusive: 0,
  expires_at: 1234567890,
  customer_details: { address },
  line_items: { data: [{ reference: 'line-item-1', amount: 10000, amount_tax: taxTotal, metadata: { cartId: 'cart-ac6' } }] },
  tax_breakdown: taxTotal
    ? [{ tax_rate_details: { tax_type: 'sales_tax', percentage_decimal: '10.25', country: address.country }, amount: taxTotal }]
    : []
});

const cart = (shippingAddress, custom) => ({
  id: 'cart-ac6',
  country: 'US',
  shippingMode: 'Single',
  totalPrice: { currencyCode: 'USD', centAmount: 10000 },
  shippingAddress,
  shippingInfo: { shippingMethod: { id: 'sm-1' }, price: { centAmount: 1000 } },
  lineItems: [{ id: 'line-item-1', productId: 'product-1', quantity: 1, totalPrice: { centAmount: 10000 } }],
  ...(custom ? { paymentInfo: { payments: [{ typeId: 'payment', id: 'pay-1' }] }, custom } : {})
});

describe('SB3-238 AC-6 — lifecycle: a stored calculation is not replayed across a jurisdiction change', () => {
  let service, stripeClient;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TaxOrchestratorService();
    stripeClient = { tax: { calculations: { create: jest.fn(), retrieve: jest.fn() } } };
    createStripeClient.mockReturnValue(stripeClient);
    taxBehaviorService.determineTaxBehaviorForCart.mockReturnValue({ 'line-item-1': 'exclusive' });
    shipFromService.resolveAllShipFromAddresses.mockResolvedValue([
      { address: { country: 'US', state: 'NY', city: 'New York', postal_code: '10001' }, source: 'default' }
    ]);
    categoryService.getCategoriesForProducts.mockResolvedValue(new Map([['product-1', []]]));
    taxCodeService.getTaxCodeForProduct.mockReturnValue('txcd_99999999');
    taxCodeService.getShippingTaxCodeFromShippingInfo.mockResolvedValue('txcd_92010001');
  });

  it('phase 1 stores an Oregon (0%) calculation; phase 2 delivers to California and recalculates, not replays', async () => {
    // PHASE 1 — a fresh calculation for Portland, OR, through the real orchestrator + real update-action.
    stripeClient.tax.calculations.create.mockResolvedValueOnce(
      calcFor('taxcalc_oregon_p1', { country: 'US', state: 'OR', city: 'Portland', postal_code: '97201' }, 0)
    );
    const phase1 = await service.orchestrateTaxCalculation(cart(PORTLAND_OR));

    // The address the connector actually sent Stripe is Oregon.
    const addressSent = stripeClient.tax.calculations.create.mock.calls[0][0].customer_details.address;
    expect(addressSent).toMatchObject({ state: 'OR', postal_code: '97201' });

    // The custom fields the connector actually wrote — read from phase 1's own setCustomType action.
    const storedFields = phase1.actions.find(a => a.action === 'setCustomType').fields;
    expect(storedFields.connectorStripeTax_calculationReferences).toEqual(['taxcalc_oregon_p1']);

    // PHASE 2 — commercetools clears taxedPrice after setShippingAddress to Los Angeles, CA. The cart
    // carries exactly those stored fields, a payment is attached, and retrieve returns the very
    // calculation phase 1 made (its address is the Oregon address phase 1 sent).
    stripeClient.tax.calculations.retrieve.mockResolvedValue(calcFor('taxcalc_oregon_p1', { ...addressSent }, 0));
    stripeClient.tax.calculations.create.mockResolvedValueOnce(
      calcFor('taxcalc_ca_p2', { country: 'US', state: 'CA', city: 'Los Angeles', postal_code: '90012' }, 1025)
    );

    const phase2 = await service.reapplyExistingCalculation(cart(LOS_ANGELES_CA, { fields: storedFields }));

    // Recalculated, not replayed: a second calculation was created...
    expect(stripeClient.tax.calculations.create).toHaveBeenCalledTimes(2);
    // ...and the cart now carries the fresh California reference, not the stored Oregon one.
    const phase2Fields = phase2.actions.find(a => a.action === 'setCustomType').fields;
    expect(phase2Fields.connectorStripeTax_calculationReferences).toEqual(['taxcalc_ca_p2']);
    expect(phase2Fields.connectorStripeTax_calculationReferences).not.toContain('taxcalc_oregon_p1');
  });
});
