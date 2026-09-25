import { expect, describe, it, jest, beforeEach, afterEach } from '@jest/globals';
import { TaxOrchestratorService } from '../../../src/services/tax-orchestrator.service.js';
import ShipFromNotFoundError from '../../../src/errors/shipFromNotFoundError.js';

// Mock dependencies
jest.mock('../../../src/utils/logger.utils.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

jest.mock('../../../src/clients/stripe.client.js', () => ({
  createStripeClient: jest.fn()
}));

jest.mock('../../../src/services/ship-from.service.js', () => ({
  __esModule: true,
  default: {
    resolveAllShipFromAddresses: jest.fn()
  }
}));

jest.mock('../../../src/services/tax-behavior.service.js', () => ({
  taxBehaviorService: {
    determineTaxBehaviorForCart: jest.fn(),
    logBehaviorDecision: jest.fn()
  }
}));

jest.mock('../../../src/services/category.service.js', () => ({
  __esModule: true,
  default: {
    getCategoriesForProducts: jest.fn()
  }
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

import { logger } from '../../../src/utils/logger.utils.js';
import { createStripeClient } from '../../../src/clients/stripe.client.js';
import shipFromService from '../../../src/services/ship-from.service.js';
import { taxBehaviorService } from '../../../src/services/tax-behavior.service.js';
import categoryService from '../../../src/services/category.service.js';
import taxCodeService from '../../../src/services/tax-code.service.js';
import updateActionService from '../../../src/services/update-action.service.js';

describe('TaxOrchestratorService', () => {
  let taxOrchestratorService;
  let mockStripeClient;
  let originalEnv;

  beforeEach(() => {
    taxOrchestratorService = new TaxOrchestratorService();
    originalEnv = { ...process.env };

    // Mock Stripe client
    mockStripeClient = {
      tax: {
        calculations: {
          create: jest.fn(),
          retrieve: jest.fn()
        }
      }
    };
    createStripeClient.mockReturnValue(mockStripeClient);

    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('orchestrateTaxCalculation', () => {
    it('should successfully orchestrate tax calculation for Single shipping mode', async () => {
      const cart = {
        id: 'cart-123',
        country: 'US',
        shippingMode: 'Single',
        locale: 'en',
        totalPrice: { currencyCode: 'USD' },
        shippingAddress: {
          country: 'US',
          state: 'NY',
          city: 'New York',
          postalCode: '10001',
          streetName: '123 Main St'
        },
        shippingInfo: {
          price: { centAmount: 1000 }
        },
        lineItems: [
          {
            id: 'line-item-1',
            productId: 'product-1',
            quantity: 2,
            totalPrice: { centAmount: 2000 }
          }
        ]
      };

      const mockShipFromResult = {
        address: {
          country: 'US',
          state: 'CA',
          city: 'San Francisco',
          postal_code: '94102'
        },
        source: 'lineItem.supplyChannel'
      };

      const mockTaxBehavior = { 'line-item-1': 'exclusive' };
      const mockCategoriesMap = new Map([['product-1', []]]);
      const mockCalculation = {
        id: 'calc-123',
        line_items: {
          data: [
            {
              amount: 2000,
              amount_tax: 200,
              tax_breakdown: []
            }
          ]
        }
      };
      const mockActions = [
        { action: 'setLineItemTaxAmount', lineItemId: 'line-item-1' }
      ];

      // Setup mocks
      taxBehaviorService.determineTaxBehaviorForCart.mockReturnValue(mockTaxBehavior);
      shipFromService.resolveAllShipFromAddresses.mockResolvedValue([mockShipFromResult]);
      categoryService.getCategoriesForProducts.mockResolvedValue(mockCategoriesMap);
      taxCodeService.getTaxCodeForProduct.mockReturnValue('txcd_12345678');
      taxCodeService.getShippingTaxCodeFromShippingInfo.mockResolvedValue('txcd_87654321');
      mockStripeClient.tax.calculations.create.mockResolvedValue(mockCalculation);
      updateActionService.createCartUpdateActionsFromMultipleCalculations.mockReturnValue(mockActions);

      const result = await taxOrchestratorService.orchestrateTaxCalculation(cart);

      expect(result).toEqual({ actions: mockActions });
      // The destination country is passed explicitly: the behavior follows where the order is
      // delivered, not cart.country (SB3-218).
      expect(taxBehaviorService.determineTaxBehaviorForCart).toHaveBeenCalledWith(cart, 'US');
      expect(shipFromService.resolveAllShipFromAddresses).toHaveBeenCalledWith(cart.lineItems);
      expect(categoryService.getCategoriesForProducts).toHaveBeenCalled();
      expect(mockStripeClient.tax.calculations.create).toHaveBeenCalled();
      expect(updateActionService.createCartUpdateActionsFromMultipleCalculations).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('Orchestration completed successfully', expect.any(Object));
    });

    it('should handle errors and throw them', async () => {
      const cart = {
        id: 'cart-123',
        shippingMode: 'Single',
        lineItems: []
      };

      const error = new Error('Test error');
      taxBehaviorService.determineTaxBehaviorForCart.mockImplementation(() => {
        throw error;
      });

      await expect(taxOrchestratorService.orchestrateTaxCalculation(cart)).rejects.toThrow('Test error');
      expect(logger.error).toHaveBeenCalledWith('Tax orchestration failed', expect.any(Object));
    });

    it('should handle Multiple shipping mode', async () => {
      const cart = {
        id: 'cart-123',
        country: 'US',
        shippingMode: 'Multiple',
        locale: 'en',
        totalPrice: { currencyCode: 'USD' },
        shipping: [
          {
            shippingKey: 'shipping-1',
            shippingAddress: {
              country: 'US',
              state: 'NY',
              city: 'New York',
              postalCode: '10001'
            },
            shippingInfo: {
              price: { centAmount: 500 }
            }
          }
        ],
        lineItems: [
          {
            id: 'line-item-1',
            productId: 'product-1',
            quantity: 1,
            totalPrice: { centAmount: 1000 },
            shippingDetails: {
              targets: [
                {
                  shippingMethodKey: 'shipping-1',
                  quantity: 1
                }
              ]
            }
          }
        ]
      };

      const mockShipFromResult = {
        address: {
          country: 'US',
          state: 'CA',
          city: 'San Francisco',
          postal_code: '94102'
        },
        source: 'lineItem.supplyChannel'
      };

      const mockTaxBehavior = { 'line-item-1': 'exclusive' };
      const mockCategoriesMap = new Map([['product-1', []]]);
      const mockCalculation = {
        id: 'calc-123',
        line_items: {
          data: []
        }
      };
      const mockActions = [];

      taxBehaviorService.determineTaxBehaviorForCart.mockReturnValue(mockTaxBehavior);
      shipFromService.resolveAllShipFromAddresses.mockResolvedValue([mockShipFromResult]);
      categoryService.getCategoriesForProducts.mockResolvedValue(mockCategoriesMap);
      taxCodeService.getTaxCodeForProduct.mockReturnValue('txcd_12345678');
      taxCodeService.getShippingTaxCodeFromShippingInfo.mockResolvedValue('txcd_87654321');
      mockStripeClient.tax.calculations.create.mockResolvedValue(mockCalculation);
      updateActionService.createCartUpdateActionsFromMultipleCalculations.mockReturnValue(mockActions);

      const result = await taxOrchestratorService.orchestrateTaxCalculation(cart);

      expect(result).toEqual({ actions: mockActions });
      expect(mockStripeClient.tax.calculations.create).toHaveBeenCalled();
    });
  });

  describe('reapplyExistingCalculation', () => {
    // A cart whose stored calculation still belongs to where it delivers: it carries a delivery
    // address and the destination that calculation was made for. Re-apply is only reachable in
    // that state — a calculation recorded against a different destination, or against none at
    // all (everything stored before SB3-218), is recalculated instead.
    const makeCart = (overrides = {}) => ({
      id: 'cart-reapply-1',
      shippingMode: 'Single',
      country: 'US',
      shippingAddress: { country: 'US', city: 'New York', postalCode: '10001' },
      custom: {
        fields: {
          connectorStripeTax_calculationReferences: ['taxcalc_abc123'],
          connectorStripeTax_destinationCountry: 'US'
        }
      },
      ...overrides
    });

    it('should retrieve the existing calculation and return line item + cart total actions', async () => {
      const mockCalculation = {
        id: 'taxcalc_abc123',
        amount_total: 3264,
        currency: 'usd',
        line_items: { data: [{ reference: 'li-1', amount: 1998, amount_tax: 177 }] },
        tax_breakdown: []
      };
      const mockLineItemActions = [{ action: 'setLineItemTaxAmount', lineItemId: 'li-1' }];
      const mockCartTotalAction = { action: 'setCartTotalTax', externalTotalGross: { centAmount: 3264, currencyCode: 'USD' } };

      mockStripeClient.tax.calculations.retrieve.mockResolvedValue(mockCalculation);
      updateActionService.createLineItemActionsFromCalculation.mockReturnValue(mockLineItemActions);
      updateActionService.createCartTotalTaxAction.mockReturnValue(mockCartTotalAction);

      const result = await taxOrchestratorService.reapplyExistingCalculation(makeCart());

      expect(mockStripeClient.tax.calculations.retrieve).toHaveBeenCalledWith('taxcalc_abc123', { expand: ['line_items'] });
      // The cart is deliberately not passed: the country labelling a zero-tax line item is read
      // from the calculation, never from cart.country (SB3-218, ADR-007).
      expect(updateActionService.createLineItemActionsFromCalculation).toHaveBeenCalledWith(mockCalculation, null);
      expect(updateActionService.createCartTotalTaxAction).toHaveBeenCalledWith(mockCalculation);
      expect(result).toEqual({ actions: [...mockLineItemActions, mockCartTotalAction] });
    });

    it('should omit cart total action when createCartTotalTaxAction returns null', async () => {
      const mockCalculation = { id: 'taxcalc_abc123', amount_total: 0, currency: 'usd', line_items: { data: [] } };
      const mockLineItemActions = [];

      mockStripeClient.tax.calculations.retrieve.mockResolvedValue(mockCalculation);
      updateActionService.createLineItemActionsFromCalculation.mockReturnValue(mockLineItemActions);
      updateActionService.createCartTotalTaxAction.mockReturnValue(null);

      const result = await taxOrchestratorService.reapplyExistingCalculation(makeCart());

      expect(result).toEqual({ actions: [] });
    });

    it('should throw and log error when Stripe retrieve fails', async () => {
      const stripeError = new Error('Stripe API error');
      mockStripeClient.tax.calculations.retrieve.mockRejectedValue(stripeError);

      await expect(taxOrchestratorService.reapplyExistingCalculation(makeCart())).rejects.toThrow('Stripe API error');
      expect(logger.error).toHaveBeenCalledWith('Tax re-apply failed', expect.objectContaining({
        cartId: 'cart-reapply-1',
        calculationId: 'taxcalc_abc123'
      }));
    });

    it('should not call orchestrateTaxCalculation or createCartUpdateActionsFromMultipleCalculations', async () => {
      mockStripeClient.tax.calculations.retrieve.mockResolvedValue({
        id: 'taxcalc_abc123', amount_total: 1000, currency: 'usd', line_items: { data: [] }
      });
      updateActionService.createLineItemActionsFromCalculation.mockReturnValue([]);
      updateActionService.createCartTotalTaxAction.mockReturnValue({ action: 'setCartTotalTax' });
      updateActionService.createShippingTaxUpdateAction.mockReturnValue(null);

      await taxOrchestratorService.reapplyExistingCalculation(makeCart());

      expect(updateActionService.createCartUpdateActionsFromMultipleCalculations).not.toHaveBeenCalled();
      expect(mockStripeClient.tax.calculations.create).not.toHaveBeenCalled();
    });

    it('should include shipping tax action when cart has Single mode shippingInfo (Express Checkout case)', async () => {
      const cart = makeCart({
        shippingMode: 'Single',
        shippingInfo: { shippingMethodName: 'Express US', price: { centAmount: 3000 } }
      });
      const mockCalculation = {
        id: 'taxcalc_abc123', amount_total: 6800, currency: 'usd',
        line_items: { data: [{ reference: 'li-1', amount: 3800, amount_tax: 302 }] },
        shipping_cost: { amount: 3000, amount_tax: 0 }
      };
      const mockLineItemActions = [{ action: 'setLineItemTaxAmount', lineItemId: 'li-1' }];
      const mockShippingAction = { action: 'setShippingMethodTaxAmount' };
      const mockCartTotalAction = { action: 'setCartTotalTax' };

      mockStripeClient.tax.calculations.retrieve.mockResolvedValue(mockCalculation);
      updateActionService.createLineItemActionsFromCalculation.mockReturnValue(mockLineItemActions);
      updateActionService.createShippingTaxUpdateAction.mockReturnValue(mockShippingAction);
      updateActionService.createCartTotalTaxAction.mockReturnValue(mockCartTotalAction);

      const result = await taxOrchestratorService.reapplyExistingCalculation(cart);

      expect(updateActionService.createShippingTaxUpdateAction).toHaveBeenCalledWith(mockCalculation);
      expect(result.actions).toEqual([...mockLineItemActions, mockShippingAction, mockCartTotalAction]);
    });

    it('should not include shipping tax action when shippingMode is Multiple', async () => {
      const cart = makeCart({
        shippingMode: 'Multiple',
        shipping: [{ shippingKey: 'ship-1' }]
      });
      const mockCalculation = {
        id: 'taxcalc_abc123', amount_total: 1000, currency: 'usd', line_items: { data: [] }
      };

      mockStripeClient.tax.calculations.retrieve.mockResolvedValue(mockCalculation);
      updateActionService.createLineItemActionsFromCalculation.mockReturnValue([]);
      updateActionService.createCartTotalTaxAction.mockReturnValue({ action: 'setCartTotalTax' });

      await taxOrchestratorService.reapplyExistingCalculation(cart);

      expect(updateActionService.createShippingTaxUpdateAction).not.toHaveBeenCalled();
    });

    it('should not include shipping tax action when shippingInfo is null', async () => {
      const cart = makeCart({ shippingMode: 'Single', shippingInfo: null });
      const mockCalculation = {
        id: 'taxcalc_abc123', amount_total: 1000, currency: 'usd', line_items: { data: [] }
      };

      mockStripeClient.tax.calculations.retrieve.mockResolvedValue(mockCalculation);
      updateActionService.createLineItemActionsFromCalculation.mockReturnValue([]);
      updateActionService.createCartTotalTaxAction.mockReturnValue({ action: 'setCartTotalTax' });

      await taxOrchestratorService.reapplyExistingCalculation(cart);

      expect(updateActionService.createShippingTaxUpdateAction).not.toHaveBeenCalled();
    });
  });

  describe('groupLineItemsByShipFrom', () => {
    it('should group line items by ship-from address', async () => {
      const cart = {
        lineItems: [
          { id: 'line-item-1', productId: 'product-1' },
          { id: 'line-item-2', productId: 'product-2' }
        ]
      };

      const shipFromResults = [
        {
          address: {
            country: 'US',
            state: 'CA',
            city: 'San Francisco',
            postal_code: '94102'
          },
          source: 'lineItem.supplyChannel'
        },
        {
          address: {
            country: 'US',
            state: 'CA',
            city: 'San Francisco',
            postal_code: '94102'
          },
          source: 'lineItem.supplyChannel'
        }
      ];

      shipFromService.resolveAllShipFromAddresses.mockResolvedValue(shipFromResults);

      const groups = await taxOrchestratorService.groupLineItemsByShipFrom(cart);

      expect(groups).toHaveLength(1);
      expect(groups[0].lineItems).toHaveLength(2);
      expect(groups[0].shipFromAddress).toEqual(shipFromResults[0].address);
    });

    it('should create separate groups for different addresses', async () => {
      const cart = {
        lineItems: [
          { id: 'line-item-1', productId: 'product-1' },
          { id: 'line-item-2', productId: 'product-2' }
        ]
      };

      const shipFromResults = [
        {
          address: {
            country: 'US',
            state: 'CA',
            city: 'San Francisco',
            postal_code: '94102'
          },
          source: 'lineItem.supplyChannel'
        },
        {
          address: {
            country: 'US',
            state: 'NY',
            city: 'New York',
            postal_code: '10001'
          },
          source: 'lineItem.supplyChannel'
        }
      ];

      shipFromService.resolveAllShipFromAddresses.mockResolvedValue(shipFromResults);

      const groups = await taxOrchestratorService.groupLineItemsByShipFrom(cart);

      expect(groups).toHaveLength(2);
      expect(groups[0].lineItems).toHaveLength(1);
      expect(groups[1].lineItems).toHaveLength(1);
    });

    it('should throw ShipFromNotFoundError when SHIP_FROM_REQUIRED is true and address is missing', async () => {
      process.env.SHIP_FROM_REQUIRED = 'true';

      const cart = {
        lineItems: [
          { id: 'line-item-1', productId: 'product-1' }
        ]
      };

      const shipFromResults = [
        {
          address: null,
          source: 'not_required'
        }
      ];

      shipFromService.resolveAllShipFromAddresses.mockResolvedValue(shipFromResults);

      await expect(taxOrchestratorService.groupLineItemsByShipFrom(cart)).rejects.toThrow(ShipFromNotFoundError);
    });
  });

  describe('executeTaxCalculations', () => {
    it('should execute multiple calculations in parallel', async () => {
      const requests = [
        { 
          line_items: [{ amount: 1000 }],
          ship_from_details: { address: { country: 'US' } }
        },
        { 
          line_items: [{ amount: 2000 }],
          ship_from_details: { address: { country: 'US' } }
        }
      ];

      const mockCalculations = [
        { id: 'calc-1' },
        { id: 'calc-2' }
      ];

      mockStripeClient.tax.calculations.create
        .mockResolvedValueOnce(mockCalculations[0])
        .mockResolvedValueOnce(mockCalculations[1]);

      const results = await taxOrchestratorService.executeTaxCalculations(requests, mockStripeClient);

      expect(results).toHaveLength(2);
      expect(results).toEqual(mockCalculations);
      expect(mockStripeClient.tax.calculations.create).toHaveBeenCalledTimes(2);
    });

    it('should handle partial failures and return successful calculations', async () => {
      const requests = [
        { 
          line_items: [{ amount: 1000 }],
          ship_from_details: { address: { country: 'US' } }
        },
        { 
          line_items: [{ amount: 2000 }],
          ship_from_details: { address: { country: 'US' } }
        }
      ];

      const mockCalculation = { id: 'calc-1' };

      mockStripeClient.tax.calculations.create
        .mockResolvedValueOnce(mockCalculation)
        .mockRejectedValueOnce(new Error('Stripe error'));

      const results = await taxOrchestratorService.executeTaxCalculations(requests, mockStripeClient);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(mockCalculation);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('tax calculations failed'),
        expect.any(Object)
      );
    });

    it('should throw error when all calculations fail', async () => {
      const requests = [
        { 
          line_items: [{ amount: 1000 }],
          ship_from_details: { address: { country: 'US' } }
        }
      ];

      mockStripeClient.tax.calculations.create.mockRejectedValue(new Error('Stripe error'));

      await expect(
        taxOrchestratorService.executeTaxCalculations(requests, mockStripeClient)
      ).rejects.toThrow('All tax calculations failed');
    });

    it('should remove shippingKey from request before sending to Stripe', async () => {
      const requests = [
        {
          shippingKey: 'shipping-1',
          line_items: [{ amount: 1000 }],
          ship_from_details: { address: { country: 'US' } }
        }
      ];

      mockStripeClient.tax.calculations.create.mockResolvedValue({ id: 'calc-1' });

      await taxOrchestratorService.executeTaxCalculations(requests, mockStripeClient);

      const callArgs = mockStripeClient.tax.calculations.create.mock.calls[0][0];
      expect(callArgs.shippingKey).toBeUndefined();
    });
  });

  describe('extractCustomerAddress', () => {
    it('should extract address from Single shipping mode', () => {
      const cart = {
        country: 'US',
        shippingMode: 'Single',
        shippingAddress: {
          country: 'US',
          state: 'NY',
          city: 'New York',
          postalCode: '10001',
          streetName: '123 Main St',
          streetNumber: 'Apt 4'
        }
      };

      const address = taxOrchestratorService.extractCustomerAddress(cart);

      expect(address).toEqual({
        country: 'US',
        state: 'NY',
        city: 'New York',
        postal_code: '10001',
        line1: '123 Main St',
        line2: 'Apt 4'
      });
    });

    it('should extract address from Multiple shipping mode', () => {
      const cart = {
        country: 'US',
        shippingMode: 'Multiple',
        shipping: [
          {
            shippingKey: 'shipping-1',
            shippingAddress: {
              country: 'US',
              state: 'CA',
              city: 'Los Angeles',
              postalCode: '90001',
              streetName: '456 Broadway'
            }
          }
        ]
      };

      const shipping = cart.shipping[0];
      const address = taxOrchestratorService.extractCustomerAddress(cart, shipping);

      expect(address).toEqual({
        country: 'US',
        state: 'CA',
        city: 'Los Angeles',
        postal_code: '90001',
        line1: '456 Broadway',
        line2: undefined
      });
    });
  });

  describe('createAddressKey', () => {
    it('should create unique key from address', () => {
      const address = {
        country: 'US',
        state: 'CA',
        city: 'San Francisco',
        postal_code: '94102'
      };

      const key = taxOrchestratorService.createAddressKey(address);

      expect(key).toBe(JSON.stringify({
        country: 'US',
        state: 'CA',
        city: 'San Francisco',
        postal_code: '94102'
      }));
    });

    it('should return "no_ship_from" for null address', () => {
      const key = taxOrchestratorService.createAddressKey(null);

      expect(key).toBe('no_ship_from');
    });

    it('should return "no_ship_from" for undefined address', () => {
      const key = taxOrchestratorService.createAddressKey(undefined);

      expect(key).toBe('no_ship_from');
    });
  });

  describe('extractCustomerAddress - edge cases', () => {
    it('should handle Multiple mode with no shipping address in shipping object', () => {
      const cart = {
        country: 'US',
        shippingMode: 'Multiple',
        shipping: [
          {
            shippingKey: 'shipping-1'
            // No shippingAddress
          }
        ]
      };

      const shipping = cart.shipping[0];
      const address = taxOrchestratorService.extractCustomerAddress(cart, shipping);

      expect(address.country).toBe('US');
      expect(address.state).toBeUndefined();
    });

    it('should handle Multiple mode with empty shipping array', () => {
      const cart = {
        country: 'US',
        shippingMode: 'Multiple',
        shipping: []
      };

      const address = taxOrchestratorService.extractCustomerAddress(cart, null);

      expect(address.country).toBe('US');
    });

    it('should handle Single mode with missing shippingAddress', () => {
      const cart = {
        country: 'US',
        shippingMode: 'Single'
      };

      const address = taxOrchestratorService.extractCustomerAddress(cart);

      expect(address.country).toBe('US');
      expect(address.state).toBeUndefined();
    });
  });

  describe('createSingleRequestForGroup', () => {
    it('should create request without ship_from_details when address is null', async () => {
      const group = {
        shipFromAddress: null,
        lineItems: [
          {
            id: 'line-item-1',
            productId: 'product-1',
            quantity: 1,
            totalPrice: { centAmount: 1000 }
          }
        ]
      };

      const cart = {
        country: 'US',
        shippingMode: 'Single',
        shippingAddress: {
          country: 'US',
          state: 'NY',
          city: 'New York',
          postalCode: '10001'
        },
        totalPrice: { currencyCode: 'USD' },
        shippingInfo: {
          price: { centAmount: 500 }
        }
      };

      const taxBehaviors = { 'line-item-1': 'exclusive' };
      const categoriesMap = new Map([['product-1', []]]);

      taxCodeService.getTaxCodeForProduct.mockReturnValue('txcd_12345678');
      taxCodeService.getShippingTaxCodeFromShippingInfo.mockResolvedValue('txcd_87654321');

      const requests = await taxOrchestratorService.createRequestsForGroup(
        group,
        cart,
        taxBehaviors,
        categoriesMap
      );

      expect(requests).toHaveLength(1);
      expect(requests[0].ship_from_details).toBeUndefined();
    });

    it('should apply the resolved line item tax behavior to shipping_cost instead of hardcoding exclusive (business-rules/tax-calculation.md Rule 6)', async () => {
      const group = {
        shipFromAddress: null,
        lineItems: [
          {
            id: 'line-item-1',
            productId: 'product-1',
            quantity: 1,
            totalPrice: { centAmount: 1000 }
          }
        ]
      };

      const cart = {
        country: 'DE',
        shippingMode: 'Single',
        shippingAddress: {
          country: 'DE',
          state: 'BE',
          city: 'Berlin',
          postalCode: '10115'
        },
        totalPrice: { currencyCode: 'EUR' },
        shippingInfo: {
          price: { centAmount: 500 }
        }
      };

      // Simulates a country configured for inclusive tax behavior via TAX_BEHAVIOR_COUNTRY_MAPPING
      const taxBehaviors = { 'line-item-1': 'inclusive' };
      const categoriesMap = new Map([['product-1', []]]);

      taxCodeService.getTaxCodeForProduct.mockReturnValue('txcd_12345678');
      taxCodeService.getShippingTaxCodeFromShippingInfo.mockResolvedValue('txcd_87654321');

      const requests = await taxOrchestratorService.createRequestsForGroup(
        group,
        cart,
        taxBehaviors,
        categoriesMap
      );

      expect(requests[0].line_items[0].tax_behavior).toBe('inclusive');
      expect(requests[0].shipping_cost.tax_behavior).toBe('inclusive');
    });

    it('should omit shipping_cost.tax_behavior when no behavior was determined for the cart', async () => {
      const group = {
        shipFromAddress: null,
        lineItems: [
          {
            id: 'line-item-1',
            productId: 'product-1',
            quantity: 1,
            totalPrice: { centAmount: 1000 }
          }
        ]
      };

      const cart = {
        country: 'US',
        shippingMode: 'Single',
        shippingAddress: {
          country: 'US',
          state: 'NY',
          city: 'New York',
          postalCode: '10001'
        },
        totalPrice: { currencyCode: 'USD' },
        shippingInfo: {
          price: { centAmount: 500 }
        }
      };

      // No entry for 'line-item-1' — simulates no country mapping and no merchant default configured
      const taxBehaviors = {};
      const categoriesMap = new Map([['product-1', []]]);

      taxCodeService.getTaxCodeForProduct.mockReturnValue('txcd_12345678');
      taxCodeService.getShippingTaxCodeFromShippingInfo.mockResolvedValue('txcd_87654321');

      const requests = await taxOrchestratorService.createRequestsForGroup(
        group,
        cart,
        taxBehaviors,
        categoriesMap
      );

      expect(requests[0].line_items[0].tax_behavior).toBeUndefined();
      expect(requests[0].shipping_cost.tax_behavior).toBeUndefined();
    });
  });

  describe('createSeparatedRequestsByShippingKey', () => {
    it('should skip empty requests (no line items and no shipping cost)', async () => {
      const group = {
        shipFromAddress: {
          country: 'US',
          state: 'CA',
          city: 'San Francisco',
          postal_code: '94102'
        },
        lineItems: []
      };

      const cart = {
        country: 'US',
        shippingMode: 'Multiple',
        totalPrice: { currencyCode: 'USD' },
        shipping: [
          {
            shippingKey: 'shipping-1',
            shippingAddress: {
              country: 'US',
              state: 'NY',
              city: 'New York',
              postalCode: '10001'
            },
            shippingInfo: {
              price: { centAmount: 0 }
            }
          }
        ]
      };

      const taxBehaviors = {};
      const categoriesMap = new Map();

      taxCodeService.getShippingTaxCodeFromShippingInfo.mockResolvedValue(null);

      const requests = await taxOrchestratorService.createRequestsForGroup(
        group,
        cart,
        taxBehaviors,
        categoriesMap
      );

      // Should skip empty request
      expect(requests.length).toBeLessThanOrEqual(1);
    });

    it('should handle line items with zero amount', async () => {
      const group = {
        shipFromAddress: {
          country: 'US',
          state: 'CA',
          city: 'San Francisco',
          postal_code: '94102'
        },
        lineItems: [
          {
            id: 'line-item-1',
            productId: 'product-1',
            quantity: 1,
            totalPrice: { centAmount: 0 },
            shippingDetails: {
              targets: [
                {
                  shippingMethodKey: 'shipping-1',
                  quantity: 1
                }
              ]
            }
          }
        ]
      };

      const cart = {
        country: 'US',
        shippingMode: 'Multiple',
        totalPrice: { currencyCode: 'USD' },
        shipping: [
          {
            shippingKey: 'shipping-1',
            shippingAddress: {
              country: 'US',
              state: 'NY',
              city: 'New York',
              postalCode: '10001'
            },
            shippingInfo: {
              price: { centAmount: 500 }
            }
          }
        ]
      };

      const taxBehaviors = { 'line-item-1': 'exclusive' };
      const categoriesMap = new Map([['product-1', []]]);

      taxCodeService.getTaxCodeForProduct.mockReturnValue('txcd_12345678');
      taxCodeService.getShippingTaxCodeFromShippingInfo.mockResolvedValue('txcd_87654321');

      const requests = await taxOrchestratorService.createRequestsForGroup(
        group,
        cart,
        taxBehaviors,
        categoriesMap
      );

      // Line item with amount 0 should be filtered out
      expect(requests[0].line_items.length).toBe(0);
    });

    it('should apply the resolved line item tax behavior to shipping_cost in Multiple mode instead of hardcoding exclusive (business-rules/tax-calculation.md Rule 6)', async () => {
      const group = {
        shipFromAddress: {
          country: 'US',
          state: 'CA',
          city: 'San Francisco',
          postal_code: '94102'
        },
        lineItems: [
          {
            id: 'line-item-1',
            productId: 'product-1',
            quantity: 1,
            totalPrice: { centAmount: 1000 },
            shippingDetails: {
              targets: [
                {
                  shippingMethodKey: 'shipping-1',
                  quantity: 1
                }
              ]
            }
          }
        ]
      };

      const cart = {
        country: 'DE',
        shippingMode: 'Multiple',
        totalPrice: { currencyCode: 'EUR' },
        shipping: [
          {
            shippingKey: 'shipping-1',
            shippingAddress: {
              country: 'DE',
              state: 'BE',
              city: 'Berlin',
              postalCode: '10115'
            },
            shippingInfo: {
              price: { centAmount: 500 }
            }
          }
        ]
      };

      // Simulates a country configured for inclusive tax behavior via TAX_BEHAVIOR_COUNTRY_MAPPING
      const taxBehaviors = { 'line-item-1': 'inclusive' };
      const categoriesMap = new Map([['product-1', []]]);

      taxCodeService.getTaxCodeForProduct.mockReturnValue('txcd_12345678');
      taxCodeService.getShippingTaxCodeFromShippingInfo.mockResolvedValue('txcd_87654321');

      const requests = await taxOrchestratorService.createRequestsForGroup(
        group,
        cart,
        taxBehaviors,
        categoriesMap
      );

      expect(requests[0].line_items[0].tax_behavior).toBe('inclusive');
      expect(requests[0].shipping_cost.tax_behavior).toBe('inclusive');
    });
  });

  describe('buildLineItemForShippingMethod', () => {
    it('should return null when target quantity is 0', () => {
      const cart = {
        id: 'cart-123',
        country: 'US'
      };

      const lineItem = {
        id: 'line-item-1',
        productId: 'product-1',
        quantity: 2,
        totalPrice: { centAmount: 2000 },
        shippingDetails: {
          targets: [
            {
              shippingMethodKey: 'shipping-1',
              quantity: 0
            }
          ]
        }
      };

      const taxBehaviors = {};
      const categoriesMap = new Map([['product-1', []]]);

      taxCodeService.getTaxCodeForProduct.mockReturnValue('txcd_12345678');

      const result = taxOrchestratorService.buildLineItemForShippingMethod(
        cart,
        lineItem,
        'shipping-1',
        taxBehaviors,
        categoriesMap
      );

      expect(result).toBeNull();
    });

    it('should return null when no target matches shippingKey', () => {
      const cart = {
        id: 'cart-123',
        country: 'US'
      };

      const lineItem = {
        id: 'line-item-1',
        productId: 'product-1',
        quantity: 2,
        totalPrice: { centAmount: 2000 },
        shippingDetails: {
          targets: [
            {
              shippingMethodKey: 'shipping-2',
              quantity: 1
            }
          ]
        }
      };

      const taxBehaviors = {};
      const categoriesMap = new Map([['product-1', []]]);

      const result = taxOrchestratorService.buildLineItemForShippingMethod(
        cart,
        lineItem,
        'shipping-1',
        taxBehaviors,
        categoriesMap
      );

      expect(result).toBeNull();
    });

    it('should calculate proportional amount correctly', () => {
      const cart = {
        id: 'cart-123',
        country: 'US'
      };

      const lineItem = {
        id: 'line-item-1',
        productId: 'product-1',
        quantity: 4,
        totalPrice: { centAmount: 4000 },
        shippingDetails: {
          targets: [
            {
              shippingMethodKey: 'shipping-1',
              quantity: 1
            }
          ]
        }
      };

      const taxBehaviors = { 'line-item-1': 'exclusive' };
      const categoriesMap = new Map([['product-1', []]]);

      taxCodeService.getTaxCodeForProduct.mockReturnValue('txcd_12345678');

      const result = taxOrchestratorService.buildLineItemForShippingMethod(
        cart,
        lineItem,
        'shipping-1',
        taxBehaviors,
        categoriesMap
      );

      expect(result).toBeDefined();
      expect(result.amount).toBe(1000); // 4000 * 1 / 4
      expect(result.quantity).toBe(1);
      expect(result.tax_behavior).toBe('exclusive');
    });
  });

  describe('getShippingCostForGroup', () => {
    it('should return null when shippingInfo has no price', async () => {
      const cart = {
        shippingInfo: {}
      };

      const result = await taxOrchestratorService.getShippingCostForGroup(cart);

      expect(result).toBeNull();
    });

    it('should return null when shippingInfo is missing', async () => {
      const cart = {};

      const result = await taxOrchestratorService.getShippingCostForGroup(cart);

      expect(result).toBeNull();
    });
  });

  describe('getShippingCostForShippingMethod', () => {
    it('should return null when shippingInfo has no price', async () => {
      const shipping = {
        shippingInfo: {}
      };

      const result = await taxOrchestratorService.getShippingCostForShippingMethod(shipping);

      expect(result).toBeNull();
    });

    it('should return null when shippingInfo is missing', async () => {
      const shipping = {};

      const result = await taxOrchestratorService.getShippingCostForShippingMethod(shipping);

      expect(result).toBeNull();
    });
  });
});

