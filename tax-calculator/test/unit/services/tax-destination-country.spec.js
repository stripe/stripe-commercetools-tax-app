/**
 * SB3-218 — the tax destination must come from the delivery address, not from cart.country.
 *
 * commercetools gives a cart two country fields with two different jobs: `country` selects the
 * price and is shopper-controlled (My Carts accepts `setCountry` from a customer or anonymous
 * token), while the shipping address says where the goods go and therefore where the sale is
 * taxed. Stripe treats `customer_details.address` as "the customer's location, or transaction
 * destination", so the country in it decides the jurisdiction.
 *
 * These tests pin the delivery address as the only source of that country. They fail against the
 * pre-fix code, which took the country from `cart.country` while taking street, city and postal
 * code from the delivery address.
 */
import { expect, describe, it, jest, beforeEach } from '@jest/globals';
import { TaxOrchestratorService } from '../../../src/services/tax-orchestrator.service.js';
import InvalidTaxDestinationError from '../../../src/errors/invalidTaxDestination.error.js';

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

/** The delivery address from the report: a taxable Spanish destination. */
const MADRID = {
  country: 'ES',
  city: 'Madrid',
  postalCode: '28001',
  streetName: 'Calle de Serrano 1'
};

const BERLIN = {
  country: 'DE',
  city: 'Berlin',
  postalCode: '10115',
  streetName: 'Unter den Linden 1'
};

describe('SB3-218 — tax destination country comes from the delivery address', () => {
  let service;
  let stripeClient;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TaxOrchestratorService();

    stripeClient = {
      tax: { calculations: { create: jest.fn(), retrieve: jest.fn() } }
    };
    createStripeClient.mockReturnValue(stripeClient);

    taxBehaviorService.determineTaxBehaviorForCart.mockReturnValue({ 'line-1': 'inclusive' });
    shipFromService.resolveAllShipFromAddresses.mockResolvedValue([
      { address: { country: 'ES', city: 'Madrid', postal_code: '28001' }, source: 'default' }
    ]);
    categoryService.getCategoriesForProducts.mockResolvedValue(new Map([['product-1', []]]));
    taxCodeService.getTaxCodeForProduct.mockReturnValue('txcd_99999999');
    taxCodeService.getShippingTaxCodeFromShippingInfo.mockResolvedValue('txcd_92010001');
    stripeClient.tax.calculations.create.mockResolvedValue({
      id: 'taxcalc_test',
      line_items: { data: [{ amount: 10000, amount_tax: 2100, tax_breakdown: [] }] }
    });
    updateActionService.createCartUpdateActionsFromMultipleCalculations.mockReturnValue([]);
  });

  describe('extractCustomerAddress', () => {
    it('takes the country from the delivery address in Single mode, not from cart.country', () => {
      const cart = { country: 'US', shippingMode: 'Single', shippingAddress: MADRID };

      const address = service.extractCustomerAddress(cart);

      expect(address.country).toBe('ES');
      // The rest of the address already came from the delivery address before the fix —
      // assert it so a fix cannot "solve" the country by dropping the delivery address.
      expect(address.city).toBe('Madrid');
      expect(address.postal_code).toBe('28001');
    });

    it('takes the country from the delivery address in Multiple mode, not from cart.country', () => {
      const shipping = { shippingKey: 'ship-1', shippingAddress: MADRID };
      const cart = { country: 'US', shippingMode: 'Multiple', shipping: [shipping] };

      const address = service.extractCustomerAddress(cart, shipping);

      expect(address.country).toBe('ES');
      expect(address.city).toBe('Madrid');
    });

    it('gives each Multiple-mode destination its own country', () => {
      // Independent of any attack: a legitimate cart shipping to two countries was taxed
      // as if both went to cart.country.
      const toMadrid = { shippingKey: 'ship-es', shippingAddress: MADRID };
      const toBerlin = { shippingKey: 'ship-de', shippingAddress: BERLIN };
      const cart = { country: 'US', shippingMode: 'Multiple', shipping: [toMadrid, toBerlin] };

      expect(service.extractCustomerAddress(cart, toMadrid).country).toBe('ES');
      expect(service.extractCustomerAddress(cart, toBerlin).country).toBe('DE');
    });

    it('still falls back to cart.country when the cart has no delivery address', () => {
      // A cart before the shopper enters an address must keep calculating as it does today.
      // commercetools requires `country` on any Address, so this fallback can only be reached
      // when there is no address at all — never to complete a partial one.
      const cart = { country: 'US', shippingMode: 'Single' };

      expect(service.extractCustomerAddress(cart).country).toBe('US');
    });
  });

  describe('an unusable destination is refused, not completed', () => {
    it('rejects a delivery address that locates the order but names no country', () => {
      // The hybrid from the report: city and postal code of one jurisdiction, country of
      // another. commercetools requires `country` on every Address, so this cannot arrive
      // through the normal cart API — and it must not be repaired from cart.country.
      const cart = {
        country: 'US',
        shippingMode: 'Single',
        shippingAddress: { city: 'Madrid', postalCode: '28001', streetName: 'Calle de Serrano 1' }
      };

      expect(() => service.extractCustomerAddress(cart))
        .toThrow(InvalidTaxDestinationError);
    });

    it('names the offending shipping method in Multiple mode', () => {
      const shipping = { shippingKey: 'ship-es', shippingAddress: { city: 'Madrid' } };
      const cart = { country: 'US', shippingMode: 'Multiple', shipping: [shipping] };

      expect(() => service.extractCustomerAddress(cart, shipping))
        .toThrow(/ship-es/);
    });

    it('maps to a commercetools InvalidInput error', () => {
      const error = new InvalidTaxDestinationError({ city: 'Madrid', postalCode: '28001' }, null);
      const ctError = error.toCommercetoolsError();

      expect(error.statusCode).toBe(400);
      expect(ctError.code).toBe('InvalidInput');
      expect(ctError.extensionExtraInfo.presentFields).toEqual(['city', 'postalCode']);
    });

    it('carries the shipping method through to the commercetools error, and survives no arguments', () => {
      const scoped = new InvalidTaxDestinationError({ city: 'Madrid' }, 'ship-es');
      expect(scoped.toCommercetoolsError().message).toContain('ship-es');
      expect(scoped.toCommercetoolsError().extensionExtraInfo.shippingKey).toBe('ship-es');

      // Defensive: the error must not itself throw when constructed with nothing.
      expect(() => new InvalidTaxDestinationError().toCommercetoolsError()).not.toThrow();
    });

    it('does not reject a cart that simply has no address yet', () => {
      const cart = { country: 'US', shippingMode: 'Single', shippingAddress: {} };

      expect(() => service.extractCustomerAddress(cart)).not.toThrow();
    });
  });

  describe('tax_behavior follows the destination, not cart.country', () => {
    it('resolves the behavior from the delivery country', async () => {
      const cart = {
        id: 'cart-218-behavior',
        country: 'US',
        shippingMode: 'Single',
        totalPrice: { currencyCode: 'EUR' },
        shippingAddress: MADRID,
        lineItems: [
          { id: 'line-1', productId: 'product-1', quantity: 1, totalPrice: { centAmount: 10000 } }
        ]
      };

      await service.orchestrateTaxCalculation(cart);

      // Not 'US'. A shopper setting cart.country cannot pick the behavior any more.
      expect(taxBehaviorService.determineTaxBehaviorForCart).toHaveBeenCalledWith(cart, 'ES');
    });

    it('resolves a behavior per destination when a cart delivers to several countries', async () => {
      const cart = {
        id: 'cart-218-multi',
        country: 'US',
        shippingMode: 'Multiple',
        totalPrice: { currencyCode: 'EUR' },
        shipping: [
          {
            shippingKey: 'ship-es',
            shippingAddress: MADRID,
            shippingInfo: { price: { centAmount: 500 } }
          },
          {
            shippingKey: 'ship-de',
            shippingAddress: BERLIN,
            shippingInfo: { price: { centAmount: 500 } }
          }
        ],
        lineItems: [
          {
            id: 'line-1',
            productId: 'product-1',
            quantity: 2,
            totalPrice: { centAmount: 10000 },
            shippingDetails: {
              targets: [
                { shippingMethodKey: 'ship-es', quantity: 1 },
                { shippingMethodKey: 'ship-de', quantity: 1 }
              ]
            }
          }
        ]
      };

      await service.orchestrateTaxCalculation(cart);

      const destinations = taxBehaviorService.determineTaxBehaviorForCart.mock.calls
        .map(([, country]) => country);

      expect(destinations).toContain('ES');
      expect(destinations).toContain('DE');
      expect(destinations).not.toContain('US');
    });
  });

  describe('the price country x destination country matrix', () => {
    // The delivery country is what reaches Stripe in every combination, including the ones where
    // the two agree — those are the control: the fix must not disturb the ordinary cart.
    //
    // The third dimension in the acceptance criteria, a registered vs unregistered jurisdiction,
    // is Stripe's own behavior and cannot be observed here: these tests assert what the connector
    // *sends*, against a mocked Stripe. Whether an unregistered destination then returns zero tax
    // is verified against a real test-mode account during staging validation.
    const combinations = [
      { priceCountry: 'US', delivery: MADRID, expected: 'ES', label: 'price US, delivered to Spain' },
      { priceCountry: 'ES', delivery: MADRID, expected: 'ES', label: 'price and delivery both Spain (control)' },
      { priceCountry: 'ES', delivery: BERLIN, expected: 'DE', label: 'price Spain, delivered to Germany' },
      { priceCountry: 'DE', delivery: MADRID, expected: 'ES', label: 'price Germany, delivered to Spain' }
    ];

    describe.each(combinations)('$label', ({ priceCountry, delivery, expected }) => {
      it('sends the delivery country in Single mode', async () => {
        const cart = {
          id: 'cart-matrix-single',
          country: priceCountry,
          shippingMode: 'Single',
          totalPrice: { currencyCode: 'EUR' },
          shippingAddress: delivery,
          lineItems: [
            { id: 'line-1', productId: 'product-1', quantity: 1, totalPrice: { centAmount: 10000 } }
          ]
        };

        await service.orchestrateTaxCalculation(cart);

        const request = stripeClient.tax.calculations.create.mock.calls[0][0];
        expect(request.customer_details.address.country).toBe(expected);
      });

      it('sends the delivery country in Multiple mode', async () => {
        const cart = {
          id: 'cart-matrix-multiple',
          country: priceCountry,
          shippingMode: 'Multiple',
          totalPrice: { currencyCode: 'EUR' },
          shipping: [
            {
              shippingKey: 'ship-1',
              shippingAddress: delivery,
              shippingInfo: { price: { centAmount: 500 } }
            }
          ],
          lineItems: [
            {
              id: 'line-1',
              productId: 'product-1',
              quantity: 1,
              totalPrice: { centAmount: 10000 },
              shippingDetails: { targets: [{ shippingMethodKey: 'ship-1', quantity: 1 }] }
            }
          ]
        };

        await service.orchestrateTaxCalculation(cart);

        const request = stripeClient.tax.calculations.create.mock.calls[0][0];
        expect(request.customer_details.address.country).toBe(expected);
      });
    });
  });

  describe('shipping cost', () => {
    it('carries the tax behavior of its own destination, not of the cart country', async () => {
      // business-rules/tax-calculation.md Rule 6 makes shipping follow the line items. Now that
      // line items follow the destination, shipping has to follow it too, or a Multiple-mode cart
      // taxes its goods under one convention and its delivery under another.
      taxBehaviorService.determineTaxBehaviorForCart.mockImplementation((cart, country) => ({
        'line-1': country === 'ES' ? 'inclusive' : 'exclusive'
      }));

      const cart = {
        id: 'cart-shipping-behavior',
        country: 'US',
        shippingMode: 'Multiple',
        totalPrice: { currencyCode: 'EUR' },
        shipping: [
          {
            shippingKey: 'ship-es',
            shippingAddress: MADRID,
            shippingInfo: { price: { centAmount: 500 } }
          }
        ],
        lineItems: [
          {
            id: 'line-1',
            productId: 'product-1',
            quantity: 1,
            totalPrice: { centAmount: 10000 },
            shippingDetails: { targets: [{ shippingMethodKey: 'ship-es', quantity: 1 }] }
          }
        ]
      };

      await service.orchestrateTaxCalculation(cart);

      const request = stripeClient.tax.calculations.create.mock.calls[0][0];
      expect(request.shipping_cost.tax_behavior).toBe('inclusive');
    });
  });

  describe('carts calculated before the fix', () => {
    // How the fix reaches carts that already exist. The re-apply path replays a stored
    // calculation without asking Stripe again, so a cart poisoned before the deploy would
    // otherwise keep its result for the rest of its life. Rather than mutating every cart at
    // deploy time, a calculation is only replayed while it still belongs to where the order goes
    // — and one stored before the fix records no destination at all.
    const cartWithStoredCalculation = (fields) => ({
      id: 'cart-legacy',
      country: 'US',
      shippingMode: 'Single',
      totalPrice: { currencyCode: 'EUR' },
      shippingAddress: MADRID,
      lineItems: [
        { id: 'line-1', productId: 'product-1', quantity: 1, totalPrice: { centAmount: 10000 } }
      ],
      custom: { fields: { connectorStripeTax_calculationReferences: ['taxcalc_legacy'], ...fields } }
    });

    it('recalculates instead of replaying a calculation that recorded no destination', async () => {
      const cart = cartWithStoredCalculation({});

      await service.reapplyExistingCalculation(cart);

      expect(stripeClient.tax.calculations.retrieve).not.toHaveBeenCalled();
      expect(stripeClient.tax.calculations.create).toHaveBeenCalledTimes(1);
      expect(stripeClient.tax.calculations.create.mock.calls[0][0]
        .customer_details.address.country).toBe('ES');
    });

    it('recalculates when the cart now delivers somewhere else', async () => {
      const cart = cartWithStoredCalculation({ connectorStripeTax_destinationCountry: 'DE' });

      await service.reapplyExistingCalculation(cart);

      expect(stripeClient.tax.calculations.retrieve).not.toHaveBeenCalled();
      expect(stripeClient.tax.calculations.create).toHaveBeenCalledTimes(1);
    });

    it('still replays the calculation when the destination is unchanged', async () => {
      const cart = cartWithStoredCalculation({ connectorStripeTax_destinationCountry: 'ES' });
      stripeClient.tax.calculations.retrieve.mockResolvedValue({
        id: 'taxcalc_legacy',
        amount_total: 12100,
        currency: 'eur',
        line_items: { data: [] }
      });
      updateActionService.createLineItemActionsFromCalculation.mockReturnValue([]);
      updateActionService.createCartTotalTaxAction.mockReturnValue(null);

      await service.reapplyExistingCalculation(cart);

      expect(stripeClient.tax.calculations.retrieve).toHaveBeenCalledWith(
        'taxcalc_legacy', expect.any(Object)
      );
      expect(stripeClient.tax.calculations.create).not.toHaveBeenCalled();
    });

    it('hands the Stripe requests to the update-action service so the destination can be recorded', async () => {
      // The destination is recorded from what was actually sent to Stripe, never re-derived from
      // the cart, so the record cannot disagree with the request it describes.
      const cart = {
        id: 'cart-records-destination',
        country: 'US',
        shippingMode: 'Single',
        totalPrice: { currencyCode: 'EUR' },
        shippingAddress: MADRID,
        lineItems: [
          { id: 'line-1', productId: 'product-1', quantity: 1, totalPrice: { centAmount: 10000 } }
        ]
      };

      await service.orchestrateTaxCalculation(cart);

      const [, , requests] =
        updateActionService.createCartUpdateActionsFromMultipleCalculations.mock.calls[0];
      expect(requests[0].customer_details.address.country).toBe('ES');
    });
  });

  describe('the country that actually reaches Stripe', () => {
    it('sends the delivery country to Stripe when cart.country says otherwise', async () => {
      const cart = {
        id: 'cart-218',
        country: 'US',
        shippingMode: 'Single',
        totalPrice: { currencyCode: 'EUR' },
        shippingAddress: MADRID,
        lineItems: [
          { id: 'line-1', productId: 'product-1', quantity: 1, totalPrice: { centAmount: 10000 } }
        ]
      };

      await service.orchestrateTaxCalculation(cart);

      expect(stripeClient.tax.calculations.create).toHaveBeenCalledTimes(1);
      const request = stripeClient.tax.calculations.create.mock.calls[0][0];

      expect(request.customer_details.address.country).toBe('ES');
      // The request claims this address is the shipping address; it must therefore be one.
      expect(request.customer_details.address_source).toBe('shipping');
    });
  });
});
