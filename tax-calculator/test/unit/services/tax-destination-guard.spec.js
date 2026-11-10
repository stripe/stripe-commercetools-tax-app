/**
 * SB3-238 — a stored tax calculation must not be re-applied onto a destination it was not made for.
 *
 * v1.2.0 added a re-apply path: when a cart already has a payment and commercetools clears its
 * taxedPrice (e.g. on setShippingAddress), the connector restores the stored calculation instead
 * of recalculating. The SB3-218 guard on that path compared a cart custom field
 * (connectorStripeTax_destinationCountry) against the cart's delivery country.
 *
 * Two bypasses (both reproduced live against the running extension):
 *   Chain A — the custom field is shopper-writable through the My Carts API and does not trigger
 *             the extension, so a shopper forges it to the new country and the guard matches,
 *             replaying a cheap calculation across countries (Oregon 0% onto Berlin, no 19% VAT).
 *   Chain B — the comparison was country-only, so a jurisdiction move within one country
 *             (Portland OR → Los Angeles CA) replayed with no forgery at all.
 *
 * The fix (ADR-012): read the destination from the retrieved calculation's own
 * customer_details.address — the address Stripe taxed, which the shopper cannot write — and compare
 * at jurisdiction granularity (country + state + city + postal code). The bypass cases — Chain A,
 * Chain B, the root-cause test, and the missing-calculation and Multiple-mode tests — fail against
 * the pre-fix country-only guard and pass after the fix. The positive control (an unchanged
 * destination still replays) and the transient-error test (a non-missing retrieve error surfaces)
 * are expected to pass on both guards: they protect the preserved feature and the narrowed catch,
 * not the pre-fix behaviour.
 */
import { expect, describe, it, jest, beforeEach } from '@jest/globals';
import { TaxOrchestratorService } from '../../../src/services/tax-orchestrator.service.js';

jest.mock('../../../src/utils/logger.utils.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

jest.mock('../../../src/clients/stripe.client.js', () => ({
  createStripeClient: jest.fn()
}));

jest.mock('../../../src/services/ship-from.service.js', () => ({
  __esModule: true,
  default: { resolveAllShipFromAddresses: jest.fn() }
}));

jest.mock('../../../src/services/tax-behavior.service.js', () => ({
  taxBehaviorService: {
    determineTaxBehaviorForCart: jest.fn(),
    logBehaviorDecision: jest.fn()
  }
}));

jest.mock('../../../src/services/category.service.js', () => ({
  __esModule: true,
  default: { getCategoriesForProducts: jest.fn() }
}));

jest.mock('../../../src/services/tax-code.service.js', () => ({
  __esModule: true,
  default: {
    getTaxCodeForProduct: jest.fn(),
    getShippingTaxCodeFromShippingInfo: jest.fn()
  }
}));

jest.mock('../../../src/services/update-action.service.js', () => ({
  __esModule: true,
  default: {
    createCartUpdateActionsFromMultipleCalculations: jest.fn(),
    createLineItemActionsFromCalculation: jest.fn(),
    createCartTotalTaxAction: jest.fn(),
    createShippingTaxUpdateAction: jest.fn()
  }
}));

import { createStripeClient } from '../../../src/clients/stripe.client.js';
import shipFromService from '../../../src/services/ship-from.service.js';
import { taxBehaviorService } from '../../../src/services/tax-behavior.service.js';
import categoryService from '../../../src/services/category.service.js';
import taxCodeService from '../../../src/services/tax-code.service.js';
import updateActionService from '../../../src/services/update-action.service.js';

/** The delivery the stored calculation was made for: Oregon has no sales tax, so it was 0%. */
const PORTLAND_OR = { country: 'US', state: 'OR', city: 'Portland', postalCode: '97201', streetName: '123 SW Oak St' };
/** A higher-tax jurisdiction inside the same country (Chain B): Los Angeles, CA ~9.5%. */
const LOS_ANGELES_CA = { country: 'US', state: 'CA', city: 'Los Angeles', postalCode: '90012', streetName: '200 N Spring St' };
/** A higher-tax country (Chain A): Berlin, DE, 19% VAT. */
const BERLIN = { country: 'DE', city: 'Berlin', postalCode: '10115', streetName: 'Unter den Linden 1' };

describe('SB3-238 — a stored calculation is re-applied only to the destination it was made for', () => {
  let service;
  let stripeClient;

  /** The stored Oregon (0% tax) calculation Stripe returns on retrieve. */
  const oregonCalculation = {
    id: 'taxcalc_oregon',
    amount_total: 10000,
    currency: 'usd',
    customer_details: { address: { country: 'US', state: 'OR', city: 'Portland', postal_code: '97201' } },
    line_items: { data: [{ reference: 'line-item-1', amount: 10000, amount_tax: 0, metadata: { cartId: 'cart-sb3238' } }] },
    tax_breakdown: []
  };

  /** A cart with a payment attached and its taxedPrice cleared — the re-apply scenario. */
  // `storedDestinationCountry` defaults to 'US' — the honest value the connector itself wrote for
  // the Oregon calculation (update-action.service.js:214). Setting it on every cart is what makes
  // these tests fail on the pre-fix, country-only guard (which replayed when field === summary);
  // the fix ignores the field and compares the calculation's own address. Chain A overrides it to
  // a forged value.
  const paidCartDeliveringTo = (shippingAddress, storedDestinationCountry = 'US') => ({
    id: 'cart-sb3238',
    country: 'US',
    shippingMode: 'Single',
    totalPrice: { currencyCode: 'USD', centAmount: 10000 },
    shippingAddress,
    shippingInfo: { shippingMethod: { id: 'sm-1' }, price: { centAmount: 1000 } },
    lineItems: [{ id: 'line-item-1', productId: 'product-1', quantity: 1, totalPrice: { centAmount: 10000 } }],
    paymentInfo: { payments: [{ typeId: 'payment', id: 'pay-1' }] },
    custom: {
      fields: {
        connectorStripeTax_calculationReferences: ['taxcalc_oregon'],
        connectorStripeTax_destinationCountry: storedDestinationCountry
      }
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TaxOrchestratorService();

    stripeClient = {
      tax: { calculations: { create: jest.fn(), retrieve: jest.fn() } }
    };
    createStripeClient.mockReturnValue(stripeClient);

    // The re-apply path: by default the stored Oregon calculation is retrievable.
    stripeClient.tax.calculations.retrieve.mockResolvedValue(oregonCalculation);
    updateActionService.createLineItemActionsFromCalculation.mockReturnValue([]);
    updateActionService.createShippingTaxUpdateAction.mockReturnValue(null);
    updateActionService.createCartTotalTaxAction.mockReturnValue(null);

    // The recalculate branch delegates to orchestrateTaxCalculation — give it enough to complete.
    taxBehaviorService.determineTaxBehaviorForCart.mockReturnValue({ 'line-item-1': 'exclusive' });
    shipFromService.resolveAllShipFromAddresses.mockResolvedValue([
      { address: { country: 'US', state: 'NY', city: 'New York', postal_code: '10001' }, source: 'default' }
    ]);
    categoryService.getCategoriesForProducts.mockResolvedValue(new Map([['product-1', []]]));
    taxCodeService.getTaxCodeForProduct.mockReturnValue('txcd_99999999');
    taxCodeService.getShippingTaxCodeFromShippingInfo.mockResolvedValue('txcd_92010001');
    stripeClient.tax.calculations.create.mockResolvedValue({
      id: 'taxcalc_fresh',
      line_items: { data: [{ amount: 10000, amount_tax: 0, tax_breakdown: [] }] }
    });
    updateActionService.createCartUpdateActionsFromMultipleCalculations.mockReturnValue([]);
  });

  it('Chain B: recalculates on an intra-country jurisdiction move, instead of replaying (no forgery)', async () => {
    const cart = paidCartDeliveringTo(LOS_ANGELES_CA);

    await service.reapplyExistingCalculation(cart);

    // Recalculated: a new Stripe calculation was created for the CA delivery...
    expect(stripeClient.tax.calculations.create).toHaveBeenCalledTimes(1);
    // ...and the stale Oregon calculation was never re-emitted onto the cart.
    expect(updateActionService.createLineItemActionsFromCalculation).not.toHaveBeenCalled();
  });

  it('Chain A: a forged destination field cannot replay a calculation across countries', async () => {
    // The shopper forges connectorStripeTax_destinationCountry to "DE" and delivers to Berlin,
    // while the stored calculation was made for Oregon (US).
    const cart = paidCartDeliveringTo(BERLIN, 'DE');

    await service.reapplyExistingCalculation(cart);

    // The forged field is not the comparator: the retrieved calc's own address (US/OR) differs
    // from the real delivery (DE), so the cart is recalculated — no 0% Oregon replay onto Berlin.
    expect(stripeClient.tax.calculations.create).toHaveBeenCalledTimes(1);
    expect(updateActionService.createLineItemActionsFromCalculation).not.toHaveBeenCalled();
  });

  it('positive control: an unchanged destination still re-applies the stored calculation', async () => {
    // The v1.2.0 purpose is preserved: deliver to the same Oregon the calculation was made for.
    const cart = paidCartDeliveringTo(PORTLAND_OR);

    await service.reapplyExistingCalculation(cart);

    expect(stripeClient.tax.calculations.retrieve).toHaveBeenCalledWith('taxcalc_oregon', { expand: ['line_items'] }, { timeout: 1500, maxNetworkRetries: 0 });
    expect(stripeClient.tax.calculations.create).not.toHaveBeenCalled();
    expect(updateActionService.createLineItemActionsFromCalculation)
      .toHaveBeenCalledWith(oregonCalculation, null);
  });

  it('root cause: mutating only the destination custom field cannot change the re-apply outcome', async () => {
    // Same cart delivering to the matching Oregon, but with the field forged to a wrong country.
    // Because the field is no longer read, the outcome is identical to the honest case: it replays.
    const honest = paidCartDeliveringTo(PORTLAND_OR);
    const forged = paidCartDeliveringTo(PORTLAND_OR, 'DE');

    await service.reapplyExistingCalculation(honest);
    const createCallsAfterHonest = stripeClient.tax.calculations.create.mock.calls.length;

    await service.reapplyExistingCalculation(forged);
    const createCallsAfterForged = stripeClient.tax.calculations.create.mock.calls.length;

    // Neither replayed via a recalculation; the forged field made no difference.
    expect(createCallsAfterHonest).toBe(0);
    expect(createCallsAfterForged).toBe(0);
  });

  it('cross-cart: recalculates when the stored calculation belongs to another cart, even if the destination matches', async () => {
    // connectorStripeTax_calculationReferences is shopper-writable; a calculation made for another
    // cart must not be re-applied here even when the delivery jurisdiction happens to match.
    stripeClient.tax.calculations.retrieve.mockResolvedValue({
      ...oregonCalculation,
      line_items: { data: [{ reference: 'line-item-1', amount: 10000, amount_tax: 0, metadata: { cartId: 'some-other-cart' } }] }
    });
    const cart = paidCartDeliveringTo(PORTLAND_OR); // destination matches the Oregon calculation

    await service.reapplyExistingCalculation(cart);

    expect(stripeClient.tax.calculations.create).toHaveBeenCalledTimes(1); // recalculated, not replayed
    expect(updateActionService.createLineItemActionsFromCalculation).not.toHaveBeenCalled();
  });

  it('recalculates when the retrieved calculation has no line items (cannot verify ownership)', async () => {
    stripeClient.tax.calculations.retrieve.mockResolvedValue({ ...oregonCalculation, line_items: { data: [] } });
    await service.reapplyExistingCalculation(paidCartDeliveringTo(PORTLAND_OR));
    expect(stripeClient.tax.calculations.create).toHaveBeenCalledTimes(1);
  });

  it('recalculates when a line item carries no cartId metadata', async () => {
    stripeClient.tax.calculations.retrieve.mockResolvedValue({
      ...oregonCalculation,
      line_items: { data: [{ reference: 'line-item-1', amount: 10000, amount_tax: 0 }] } // no metadata
    });
    await service.reapplyExistingCalculation(paidCartDeliveringTo(PORTLAND_OR));
    expect(stripeClient.tax.calculations.create).toHaveBeenCalledTimes(1);
  });

  it('recalculates when line items carry mixed cartIds (not all this cart)', async () => {
    stripeClient.tax.calculations.retrieve.mockResolvedValue({
      ...oregonCalculation,
      line_items: { data: [
        { reference: 'line-item-1', amount: 5000, amount_tax: 0, metadata: { cartId: 'cart-sb3238' } },
        { reference: 'line-item-2', amount: 5000, amount_tax: 0, metadata: { cartId: 'another-cart' } }
      ] }
    });
    await service.reapplyExistingCalculation(paidCartDeliveringTo(PORTLAND_OR));
    expect(stripeClient.tax.calculations.create).toHaveBeenCalledTimes(1);
  });

  it('documents the gap: a second appended reference survives the pass (re-apply does not rewrite the field)', async () => {
    // Cart carries [this cart's valid calc, another cart's calc]. Re-apply reads [0], which belongs
    // to this cart and matches the destination, so it replays — but emits no setCustomType, so the
    // appended [1] survives to the order. order-syncer's filing-time binding refuses it there
    // (another cart's calculation: cartId mismatch) — see order-syncer's calculation-binding spec.
    const cart = {
      ...paidCartDeliveringTo(PORTLAND_OR),
      custom: { fields: { connectorStripeTax_calculationReferences: ['taxcalc_oregon', 'taxcalc_other_cart'], connectorStripeTax_destinationCountry: 'US' } }
    };

    const result = await service.reapplyExistingCalculation(cart);

    expect(stripeClient.tax.calculations.retrieve).toHaveBeenCalledWith('taxcalc_oregon', expect.any(Object), expect.any(Object));
    expect(stripeClient.tax.calculations.create).not.toHaveBeenCalled(); // replayed [0]
    expect(result.actions.some((a) => a.action === 'setCustomType')).toBe(false); // field untouched → [1] survives
  });

  it('recalculates when the stored calculation is genuinely missing (resource_missing)', async () => {
    const gone = Object.assign(new Error('No such Tax Calculation'), { code: 'resource_missing', statusCode: 404 });
    stripeClient.tax.calculations.retrieve.mockRejectedValue(gone);
    const cart = paidCartDeliveringTo(PORTLAND_OR);

    await service.reapplyExistingCalculation(cart);

    // A reference Stripe reports as gone is untrustworthy — recalculate rather than fail the cart.
    expect(stripeClient.tax.calculations.create).toHaveBeenCalledTimes(1);
  });

  it('surfaces a transient retrieve error instead of silently recalculating', async () => {
    // Auth / rate-limit / connection / outage must go through the normal error mapping, not mint a
    // new calculation that diverges from the PaymentIntent reference (ADR-008; SB3-238 review C4).
    const transient = Object.assign(new Error('Too many requests'), { type: 'StripeRateLimitError', statusCode: 429 });
    stripeClient.tax.calculations.retrieve.mockRejectedValue(transient);
    const cart = paidCartDeliveringTo(PORTLAND_OR);

    await expect(service.reapplyExistingCalculation(cart)).rejects.toThrow('Too many requests');
    expect(stripeClient.tax.calculations.create).not.toHaveBeenCalled();
  });

  it('recalculates a Multiple-shipping cart instead of re-applying a single stored calculation', async () => {
    // A single stored reference cannot safely cover more than one destination (ADR-008/ADR-012),
    // so a Multiple-shipping cart short-circuits to recalculation before any retrieve.
    const orchestrate = jest.spyOn(service, 'orchestrateTaxCalculation').mockResolvedValue({ actions: [] });
    const cart = {
      ...paidCartDeliveringTo(PORTLAND_OR),
      shippingMode: 'Multiple',
      shippingAddress: undefined,
      shipping: [
        { shippingKey: 'ship-1', shippingAddress: PORTLAND_OR, shippingInfo: { price: { centAmount: 1000 } } },
        { shippingKey: 'ship-2', shippingAddress: LOS_ANGELES_CA, shippingInfo: { price: { centAmount: 2000 } } }
      ]
    };

    await service.reapplyExistingCalculation(cart);

    expect(stripeClient.tax.calculations.retrieve).not.toHaveBeenCalled();
    expect(orchestrate).toHaveBeenCalledWith(cart);
  });

  // The two-phase lifecycle test (AC-6) lives in tax-destination-lifecycle.spec.js, where the real
  // UpdateActionService runs so phase 2 is fed what phase 1 actually stored.
});
