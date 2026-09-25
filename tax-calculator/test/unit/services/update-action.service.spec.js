// tax-calculator/test/unit/services/update-action.service.spec.js
import { expect, describe, it, jest } from '@jest/globals';
import updateActionService from '../../../src/services/update-action.service.js';
import { CART_TAX_CUSTOM_TYPE, CART_TAX_FIELD_NAMES } from '../../../src/connectors/customTypes.js';

// Mock dependencies
jest.mock('../../../src/utils/logger.utils.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

import { logger } from '../../../src/utils/logger.utils.js';

describe('UpdateActionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createCartUpdateActionsFromMultipleCalculations', () => {
    it('should create update actions from multiple calculations with or without shipping info groups', () => {
      const calculations = [
        {
          id: 'calc_123',
          currency: 'usd',
          amount_total: 1000,
          tax_amount_exclusive: 100,
          tax_amount_inclusive: 1100,
          expires_at: 1234567890,
          line_items: {
            data: [
              {
                reference: 'line-item-1',
                amount: 1000,
                amount_tax: 100
              }
            ]
          },
          tax_breakdown: [
            {
              tax_rate_details: {
                tax_type: 'sales_tax',
                percentage_decimal: '10.0',
                country: 'US'
              },
              amount: 100
            }
          ],
          shipping_cost: {
            amount: 500,
            amount_tax: 50,
            tax_breakdown: [
              {
                tax_rate_details: {
                  tax_type: 'shipping_tax',
                  percentage_decimal: '10.0',
                  country: 'US'
                }
              }
            ]
          }
        }
      ];

      const shippingInfoGroups = [
        {
          shippingKey: 'shipping-key-1',
          taxCode: 'txcd_shipping_01',
          lineItems: ['line-item-1']
        }
      ];

      const result1 = updateActionService.createCartUpdateActionsFromMultipleCalculations(
        calculations,
        shippingInfoGroups
      );

      expect(result1).toBeInstanceOf(Array);
      expect(result1.length).toBeGreaterThan(0);
      
      // Verify all action types are created
      const actionTypes = result1.map(a => a.action);
      expect(actionTypes).toContain('setCustomType');
      expect(actionTypes).toContain('setLineItemTotalPrice');
      expect(actionTypes).toContain('setLineItemTaxAmount');
      expect(actionTypes).toContain('setShippingMethodTaxAmount');
      expect(actionTypes).toContain('setCartTotalTax');
      
      expect(logger.info).toHaveBeenCalled();

      // Test without shipping info groups
      const result2 = updateActionService.createCartUpdateActionsFromMultipleCalculations(calculations);
      expect(result2).toBeInstanceOf(Array);
      expect(result2.length).toBeGreaterThan(0);

      // Test empty calculations
      const emptyResult = updateActionService.createCartUpdateActionsFromMultipleCalculations([]);
      expect(emptyResult).toBeInstanceOf(Array);
      expect(emptyResult.length).toBeGreaterThan(0);
      expect(emptyResult[0].action).toBe('setCustomType');
      expect(emptyResult[0].fields[CART_TAX_FIELD_NAMES.CALCULATION_REFERENCES]).toEqual([]);
      expect(emptyResult[0].fields[CART_TAX_FIELD_NAMES.AMOUNT_TOTAL]).toBe(0);

      // Test error handling
      expect(() => {
        updateActionService.createCartUpdateActionsFromMultipleCalculations(null);
      }).toThrow();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error creating cart update actions from multiple calculations:')
      );
    });
  });

  describe('combineCalculations', () => {
    it('should combine multiple calculations, handling missing shipping cost and line items', () => {
      const calculations = [
        {
          id: 'calc_1',
          currency: 'usd',
          amount_total: 1000,
          tax_amount_exclusive: 100,
          tax_amount_inclusive: 1100,
          expires_at: 1234567890,
          line_items: {
            data: [
              {
                reference: 'line-item-1',
                amount: 1000,
                amount_tax: 100
              }
            ]
          },
          shipping_cost: {
            amount: 500,
            amount_tax: 50
          }
        },
        {
          id: 'calc_2',
          currency: 'usd',
          amount_total: 2000,
          tax_amount_exclusive: 200,
          tax_amount_inclusive: 2200,
          expires_at: 1234567891,
          line_items: {
            data: [
              {
                reference: 'line-item-2',
                amount: 2000,
                amount_tax: 200
              }
            ]
          },
          shipping_cost: {
            amount: 1000,
            amount_tax: 100
          }
        }
      ];

      const result = updateActionService.combineCalculations(calculations);
      expect(result.calculation_references).toEqual(['calc_1', 'calc_2']);
      expect(result.amount_total).toBe(3000);
      expect(result.tax_amount_exclusive).toBe(300);
      expect(result.tax_amount_inclusive).toBe(3300);
      // currencies format: `${calc.id}_${currency.toUpperCase()}`
      expect(result.currencies).toEqual(['calc_1_USD', 'calc_2_USD']);
      expect(result.line_items.data).toHaveLength(2);
      expect(result.shipping_cost.amount).toBe(1500);
      expect(result.shipping_cost.amount_tax).toBe(150);

      // Test without shipping cost
      const calcNoShipping = [
        {
          id: 'calc_1',
          currency: 'usd',
          amount_total: 1000,
          tax_amount_exclusive: 100,
          tax_amount_inclusive: 1100,
          expires_at: 1234567890,
          line_items: { data: [] }
        }
      ];
      const result2 = updateActionService.combineCalculations(calcNoShipping);
      expect(result2.shipping_cost.amount).toBe(0);
      expect(result2.shipping_cost.amount_tax).toBe(0);

      // Test without line items
      const calcNoLineItems = [
        {
          id: 'calc_1',
          currency: 'usd',
          amount_total: 1000,
          tax_amount_exclusive: 100,
          tax_amount_inclusive: 1100,
          expires_at: 1234567890
        }
      ];
      const result3 = updateActionService.combineCalculations(calcNoLineItems);
      expect(result3.line_items.data).toEqual([]);

      // Test empty array
      const result4 = updateActionService.combineCalculations([]);
      expect(result4.calculation_references).toEqual([]);
      expect(result4.amount_total).toBe(0);
      expect(result4.tax_amount_exclusive).toBe(0);
    });
  });

  describe('summariseDestinations (SB3-218)', () => {
    const requestTo = (country) => ({ customer_details: { address: { country } } });

    it('records the destination a single-destination calculation was made for', () => {
      expect(updateActionService.summariseDestinations([requestTo('ES')])).toBe('ES');
    });

    it('records every destination, sorted and deduplicated, for a multi-destination cart', () => {
      const requests = [requestTo('ES'), requestTo('DE'), requestTo('ES')];
      expect(updateActionService.summariseDestinations(requests)).toBe('DE,ES');
    });

    it('returns an empty record rather than inventing one when no country is known', () => {
      // An empty record is what makes a stored calculation un-replayable. It must never be
      // filled in from somewhere else — that is how the cart would silently keep a calculation
      // made against a destination nobody verified.
      expect(updateActionService.summariseDestinations([])).toBe('');
      expect(updateActionService.summariseDestinations([{}])).toBe('');
      expect(updateActionService.summariseDestinations()).toBe('');
    });
  });

  describe('createCartCustomTypeUpdateAction', () => {
    it('stores the destination alongside the calculation', () => {
      const result = updateActionService.createCartCustomTypeUpdateAction(
        { calculation_references: ['calc_1'] },
        [{ customer_details: { address: { country: 'ES' } } }]
      );

      expect(result.fields[CART_TAX_FIELD_NAMES.DESTINATION_COUNTRY]).toBe('ES');
    });

    it('should create custom type update action with all fields', () => {
      const calculation = {
        calculation_references: ['calc_123'],
        amount_total: 1000,
        tax_amount_exclusive: 100,
        tax_amount_inclusive: 1100,
        currencies: ['USD'],
        expires_at: ['2024-01-01T00:00:00.000Z']
      };

      const result = updateActionService.createCartCustomTypeUpdateAction(calculation);
      expect(result.action).toBe('setCustomType');
      expect(result.type.key).toBe(CART_TAX_CUSTOM_TYPE.key);
      expect(result.type.typeId).toBe('type');
      expect(result.fields[CART_TAX_FIELD_NAMES.CALCULATION_REFERENCES]).toEqual(['calc_123']);
      expect(result.fields[CART_TAX_FIELD_NAMES.AMOUNT_TOTAL]).toBe(1000);
      expect(result.fields[CART_TAX_FIELD_NAMES.TAX_AMOUNT_EXCLUSIVE]).toBe(100);
      expect(result.fields[CART_TAX_FIELD_NAMES.TAX_AMOUNT_INCLUSIVE]).toBe(1100);
      expect(result.fields[CART_TAX_FIELD_NAMES.CURRENCIES]).toEqual(['USD']);
      expect(result.fields[CART_TAX_FIELD_NAMES.EXPIRES_AT]).toEqual(['2024-01-01T00:00:00.000Z']);
      expect(result.fields[CART_TAX_FIELD_NAMES.CALCULATION_TIMESTAMP]).toBeDefined();

      // Test empty references
      const calcEmpty = {
        calculation_references: [],
        amount_total: 1000,
        tax_amount_exclusive: 100,
        tax_amount_inclusive: 1100,
        currencies: [],
        expires_at: []
      };
      const result2 = updateActionService.createCartCustomTypeUpdateAction(calcEmpty);
      expect(result2.fields[CART_TAX_FIELD_NAMES.CALCULATION_REFERENCES]).toEqual([]);
    });
  });

  describe('createLineItemTaxUpdateActions', () => {
    it('should create line item actions from calculations and combine duplicates with same shippingKey', () => {
      const calculations = [
        {
          id: 'calc_1',
          currency: 'usd',
          line_items: {
            data: [
              {
                reference: 'line-item-1',
                amount: 1000,
                amount_tax: 100
              }
            ]
          },
          tax_breakdown: [
            {
              tax_rate_details: {
                tax_type: 'sales_tax',
                percentage_decimal: '10.0',
                country: 'US'
              },
              amount: 100
            }
          ]
        }
      ];

      const shippingInfoGroups = [
        {
          shippingKey: 'shipping-key-1',
          lineItems: ['line-item-1']
        }
      ];

      // Create line item total price actions first (required parameter)
      const lineItemTotalPriceActions = updateActionService.createLineItemTotalPriceActions(calculations, shippingInfoGroups);
      
      const result1 = updateActionService.createLineItemTaxUpdateActions(
        calculations, 
        shippingInfoGroups,
        lineItemTotalPriceActions
      );
      expect(result1).toBeInstanceOf(Array);
      expect(result1.length).toBeGreaterThan(0);
      expect(result1[0].action).toBe('setLineItemTaxAmount');
      expect(result1[0].lineItemId).toBe('line-item-1');
      expect(logger.debug).toHaveBeenCalled();

      // Test combining duplicates
      const duplicateCalculations = [
        {
          id: 'calc_1',
          currency: 'usd',
          line_items: {
            data: [
              {
                reference: 'line-item-1',
                amount: 1000,
                amount_tax: 100
              }
            ]
          },
          tax_breakdown: [
            {
              tax_rate_details: {
                tax_type: 'sales_tax',
                percentage_decimal: '10.0',
                country: 'US'
              },
              amount: 100
            }
          ]
        },
        {
          id: 'calc_2',
          currency: 'usd',
          line_items: {
            data: [
              {
                reference: 'line-item-1',
                amount: 1000,
                amount_tax: 100
              }
            ]
          },
          tax_breakdown: [
            {
              tax_rate_details: {
                tax_type: 'sales_tax',
                percentage_decimal: '10.0',
                country: 'US'
              },
              amount: 100
            }
          ]
        }
      ];

      const duplicateShippingGroups = [
        {
          shippingKey: 'shipping-key-1',
          lineItems: ['line-item-1']
        },
        {
          shippingKey: 'shipping-key-1',
          lineItems: ['line-item-1']
        }
      ];

      const duplicateLineItemTotalPriceActions = updateActionService.createLineItemTotalPriceActions(
        duplicateCalculations,
        duplicateShippingGroups
      );
      
      const result2 = updateActionService.createLineItemTaxUpdateActions(
        duplicateCalculations,
        duplicateShippingGroups,
        duplicateLineItemTotalPriceActions
      );
      expect(result2.length).toBe(1);
      // Combined totalGross: (1000 + 100) + (1000 + 100) = 2200
      // Each calculation has amount=1000, amount_tax=100, so totalGross = 1100 each
      // Combined: 1100 + 1100 = 2200
      expect(result2[0].externalTaxAmount.totalGross.centAmount).toBe(2200);

      // Test without shipping info groups
      const lineItemTotalPriceActions3 = updateActionService.createLineItemTotalPriceActions(calculations);
      const result3 = updateActionService.createLineItemTaxUpdateActions(
        calculations,
        [],
        lineItemTotalPriceActions3
      );
      expect(result3).toBeInstanceOf(Array);
    });
  });

  describe('createLineItemActionsFromCalculation', () => {
    it('should create line item actions with or without shippingKey, handle missing data', () => {
      const calculation = {
        id: 'calc_123',
        currency: 'usd',
        line_items: {
          data: [
            {
              reference: 'line-item-1',
              amount: 1000,
              amount_tax: 100
            }
          ]
        },
        tax_breakdown: [
          {
            tax_rate_details: {
              tax_type: 'sales_tax',
              percentage_decimal: '10.0',
              country: 'US'
            },
            amount: 100
          }
        ]
      };

      // Test with shippingKey and cart
      const cart = { country: 'US', shippingAddress: { country: 'US' } };
      const result1 = updateActionService.createLineItemActionsFromCalculation(calculation, 'shipping-key-1', cart);
      expect(result1).toHaveLength(1);
      expect(result1[0].action).toBe('setLineItemTaxAmount');
      expect(result1[0].lineItemId).toBe('line-item-1');
      expect(result1[0].shippingKey).toBe('shipping-key-1');
      expect(result1[0].externalTaxAmount.totalGross.centAmount).toBe(1100); // amount (1000) + amount_tax (100)
      expect(result1[0].externalTaxAmount.taxRate.name).toBe('sales_tax');
      expect(result1[0].externalTaxAmount.taxRate.amount).toBe(0.1);

      // Test without shippingKey
      const result2 = updateActionService.createLineItemActionsFromCalculation(calculation, null, cart);
      expect(result2[0].shippingKey).toBeUndefined();

      // Test without line items
      const calcNoLineItems = {
        id: 'calc_123',
        currency: 'usd',
        line_items: { data: [] },
        tax_breakdown: []
      };
      expect(updateActionService.createLineItemActionsFromCalculation(calcNoLineItems, null, cart)).toHaveLength(0);

      // Test without tax breakdown - should still create action with tax = 0
      const calcNoBreakdown = {
        id: 'calc_123',
        currency: 'usd',
        line_items: {
          data: [
            {
              reference: 'line-item-1',
              amount: 1000,
              amount_tax: 0
            }
          ]
        },
        tax_breakdown: []
      };
      const result3 = updateActionService.createLineItemActionsFromCalculation(calcNoBreakdown, null, cart);
      expect(result3).toHaveLength(1); // Should create action even without breakdown
      expect(result3[0].externalTaxAmount.totalGross.centAmount).toBe(1000); // amount + 0 tax
      expect(result3[0].externalTaxAmount.taxRate.amount).toBe(0);
      expect(logger.warn).toHaveBeenCalled();

      // Test missing currency - defaults to USD
      const calcNoCurrency = {
        id: 'calc_123',
        line_items: {
          data: [
            {
              reference: 'line-item-1',
              amount: 1000,
              amount_tax: 100
            }
          ]
        },
        tax_breakdown: [
          {
            tax_rate_details: {
              tax_type: 'sales_tax',
              percentage_decimal: '10.0',
              country: 'US'
            }
          }
        ]
      };
      const result4 = updateActionService.createLineItemActionsFromCalculation(calcNoCurrency, null, cart);
      expect(result4[0].externalTaxAmount.totalGross.currencyCode).toBe('USD');
    });
  });

  describe('createLineItemTotalPriceActions', () => {
    it('should create setLineItemTotalPrice actions for each line item', () => {
      const calculations = [
        {
          id: 'calc_1',
          currency: 'usd',
          line_items: {
            data: [
              {
                reference: 'line-item-1',
                amount: 1000,
                quantity: 2
              },
              {
                reference: 'line-item-2',
                amount: 2000,
                quantity: 1
              }
            ]
          }
        }
      ];

      const shippingInfoGroups = [
        {
          shippingKey: 'shipping-key-1',
          lineItems: ['line-item-1', 'line-item-2']
        }
      ];

      const result = updateActionService.createLineItemTotalPriceActions(calculations, shippingInfoGroups);

      expect(result).toHaveLength(2);
      expect(result[0].action).toBe('setLineItemTotalPrice');
      expect(result[0].lineItemId).toBe('line-item-1');
      expect(result[0].shippingKey).toBe('shipping-key-1');
      expect(result[0].externalTotalPrice.totalPrice.centAmount).toBe(1000);
      expect(result[0].externalTotalPrice.price.centAmount).toBe(500); // 1000 / 2
      
      expect(result[1].lineItemId).toBe('line-item-2');
      expect(result[1].externalTotalPrice.totalPrice.centAmount).toBe(2000);
      expect(result[1].externalTotalPrice.price.centAmount).toBe(2000); // 2000 / 1
      
      expect(logger.debug).toHaveBeenCalled();
    });

    it('should combine duplicates when same lineItemId + shippingKey appears in multiple calculations', () => {
      const calculations = [
        {
          id: 'calc_1',
          currency: 'usd',
          line_items: {
            data: [
              {
                reference: 'line-item-1',
                amount: 1000,
                quantity: 1
              }
            ]
          }
        },
        {
          id: 'calc_2',
          currency: 'usd',
          line_items: {
            data: [
              {
                reference: 'line-item-1',
                amount: 500,
                quantity: 1
              }
            ]
          }
        }
      ];

      const shippingInfoGroups = [
        {
          shippingKey: 'shipping-key-1',
          lineItems: ['line-item-1']
        },
        {
          shippingKey: 'shipping-key-1',
          lineItems: ['line-item-1']
        }
      ];

      const result = updateActionService.createLineItemTotalPriceActions(calculations, shippingInfoGroups);

      expect(result).toHaveLength(1);
      expect(result[0].externalTotalPrice.totalPrice.centAmount).toBe(1500); // 1000 + 500
      expect(result[0].externalTotalPrice.price.centAmount).toBe(750); // 1500 / 2
    });

    it('should handle Single mode (no shippingKey)', () => {
      const calculations = [
        {
          id: 'calc_1',
          currency: 'usd',
          line_items: {
            data: [
              {
                reference: 'line-item-1',
                amount: 1000,
                quantity: 1
              }
            ]
          }
        }
      ];

      const result = updateActionService.createLineItemTotalPriceActions(calculations, []);

      expect(result).toHaveLength(1);
      expect(result[0].shippingKey).toBeUndefined();
    });
  });

  describe('createCartTotalTaxAction', () => {
    it('should create setCartTotalTax action with amount_total', () => {
      const calculation = {
        currency: 'usd',
        amount_total: 1500
      };

      const result = updateActionService.createCartTotalTaxAction(calculation);

      expect(result).toBeDefined();
      expect(result.action).toBe('setCartTotalTax');
      expect(result.externalTotalGross.currencyCode).toBe('USD');
      expect(result.externalTotalGross.centAmount).toBe(1500);
    });

    it('should return null when amount_total is missing or zero', () => {
      const calculation1 = {
        currency: 'usd'
      };

      const result1 = updateActionService.createCartTotalTaxAction(calculation1);
      expect(result1).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        'Cannot create cart total tax action: amount_total is missing or zero'
      );

      const calculation2 = {
        currency: 'usd',
        amount_total: 0
      };

      const result2 = updateActionService.createCartTotalTaxAction(calculation2);
      expect(result2).toBeNull();
    });

    it('should handle missing currency and default to USD', () => {
      const calculation = {
        amount_total: 1500
      };

      const result = updateActionService.createCartTotalTaxAction(calculation);

      expect(result.externalTotalGross.currencyCode).toBe('USD');
    });
  });

  describe('findTaxBreakdownForLineItem', () => {
    it('should find breakdown by calculated tax amount or most common tax type', () => {
      const lineItemTaxData = {
        reference: 'line-item-1',
        amount: 1000,
        amount_tax: 100
      };

      // Test exact match
      const taxBreakdowns1 = [
        {
          tax_rate_details: {
            tax_type: 'sales_tax',
            percentage_decimal: '10.0',
            country: 'US'
          },
          amount: 100
        }
      ];
      const result1 = updateActionService.findTaxBreakdownForLineItem(lineItemTaxData, taxBreakdowns1);
      expect(result1).toBeDefined();
      expect(result1.tax_rate_details.tax_type).toBe('sales_tax');

      // Test most common tax type when amount doesn't match
      const taxBreakdowns2 = [
        {
          tax_rate_details: {
            tax_type: 'sales_tax',
            percentage_decimal: '5.0',
            country: 'US'
          },
          amount: 50
        },
        {
          tax_rate_details: {
            tax_type: 'sales_tax',
            percentage_decimal: '5.0',
            country: 'US'
          },
          amount: 50
        },
        {
          tax_rate_details: {
            tax_type: 'vat',
            percentage_decimal: '20.0',
            country: 'GB'
          },
          amount: 200
        }
      ];
      const result2 = updateActionService.findTaxBreakdownForLineItem(lineItemTaxData, taxBreakdowns2);
      expect(result2).toBeDefined();
      expect(result2.tax_rate_details.tax_type).toBe('sales_tax');

      // Test no breakdown found
      expect(updateActionService.findTaxBreakdownForLineItem(lineItemTaxData, [])).toBeNull();

      // Test breakdown without percentage_decimal
      const taxBreakdowns3 = [
        {
          tax_rate_details: {
            tax_type: 'sales_tax',
            country: 'US'
          }
        }
      ];
      const result3 = updateActionService.findTaxBreakdownForLineItem(lineItemTaxData, taxBreakdowns3);
      expect(result3).toBeDefined();
    });
  });

  describe('createMultipleShippingTaxUpdateActions', () => {
    it('should create shipping actions for multiple shipping methods, handling zero tax and missing breakdown', () => {
      const calculations = [
        {
          id: 'calc_1',
          currency: 'usd',
          shipping_cost: {
            amount: 500,
            amount_tax: 50,
            tax_breakdown: [
              {
                tax_rate_details: {
                  tax_type: 'shipping_tax',
                  percentage_decimal: '10.0',
                  country: 'US'
                }
              }
            ]
          },
          tax_breakdown: []
        }
      ];

      const shippingInfoGroups = [
        {
          shippingKey: 'shipping-key-1',
          taxCode: 'txcd_shipping_01'
        }
      ];

      const result1 = updateActionService.createMultipleShippingTaxUpdateActions(calculations, shippingInfoGroups);
      expect(result1).toHaveLength(1);
      expect(result1[0].action).toBe('setShippingMethodTaxAmount');
      expect(result1[0].shippingKey).toBe('shipping-key-1');
      // totalGross = shippingAmount + shippingTaxAmount = 500 + 50 = 550
      expect(result1[0].externalTaxAmount.totalGross.centAmount).toBe(550);
      expect(logger.info).toHaveBeenCalled();

      // Test zero tax
      const calcZeroTax = [
        {
          id: 'calc_1',
          currency: 'usd',
          shipping_cost: {
            amount: 500,
            amount_tax: 0
          },
          tax_breakdown: [
            {
              tax_rate_details: {
                tax_type: 'sales_tax',
                percentage_decimal: '10.0',
                country: 'US'
              }
            }
          ]
        }
      ];
      const result2 = updateActionService.createMultipleShippingTaxUpdateActions(calcZeroTax, shippingInfoGroups);
      // totalGross = shippingAmount + shippingTaxAmount = 500 + 0 = 500
      expect(result2[0].externalTaxAmount.totalGross.centAmount).toBe(500);
      expect(result2[0].externalTaxAmount.taxRate.amount).toBe(0);

      // Test missing tax breakdown
      const calcNoBreakdown = [
        {
          id: 'calc_1',
          currency: 'usd',
          shipping_cost: {
            amount: 500,
            amount_tax: 50
          },
          tax_breakdown: []
        }
      ];
      const result3 = updateActionService.createMultipleShippingTaxUpdateActions(calcNoBreakdown, shippingInfoGroups);
      expect(result3).toHaveLength(1);
      // totalGross = shippingAmount + shippingTaxAmount = 500 + 0 = 500 (when no breakdown found, creates zero tax action)
      expect(result3[0].externalTaxAmount.totalGross.centAmount).toBe(500);
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('createShippingTaxUpdateAction', () => {
    it('should create shipping action with tax, handle zero tax, and find breakdown in general tax_breakdown', () => {
      const calculation = {
        currency: 'usd',
        shipping_cost: {
          amount: 500,
          amount_tax: 50,
          tax_breakdown: [
            {
              tax_rate_details: {
                tax_type: 'shipping_tax',
                percentage_decimal: '10.0',
                country: 'US'
              }
            }
          ]
        },
        tax_breakdown: []
      };

      const result1 = updateActionService.createShippingTaxUpdateAction(calculation);
      expect(result1.action).toBe('setShippingMethodTaxAmount');
      // totalGross = shippingAmount + shippingTaxAmount = 500 + 50 = 550
      expect(result1.externalTaxAmount.totalGross.centAmount).toBe(550);
      expect(result1.externalTaxAmount.taxRate.name).toBe('shipping_tax');
      expect(result1.externalTaxAmount.taxRate.amount).toBe(0.1);

      // Test zero tax
      const calcZeroTax = {
        currency: 'usd',
        shipping_cost: {
          amount: 500,
          amount_tax: 0
        },
        tax_breakdown: [
          {
            tax_rate_details: {
              tax_type: 'sales_tax',
              percentage_decimal: '10.0',
              country: 'US'
            }
          }
        ]
      };
      const result2 = updateActionService.createShippingTaxUpdateAction(calcZeroTax);
      // totalGross = shippingAmount + shippingTaxAmount = 500 + 0 = 500
      expect(result2.externalTaxAmount.totalGross.centAmount).toBe(500);
      expect(result2.externalTaxAmount.taxRate.amount).toBe(0);

      // Test finding breakdown in general tax_breakdown
      const calcGeneralBreakdown = {
        currency: 'usd',
        shipping_cost: {
          amount: 500,
          amount_tax: 50,
          tax_breakdown: []
        },
        tax_breakdown: [
          {
            tax_rate_details: {
              tax_type: 'sales_tax',
              percentage_decimal: '10.0',
              country: 'US'
            }
          }
        ]
      };
      const result3 = updateActionService.createShippingTaxUpdateAction(calcGeneralBreakdown);
      expect(result3).toBeDefined();
      // totalGross = shippingAmount + shippingTaxAmount = 500 + 50 = 550
      expect(result3.externalTaxAmount.totalGross.centAmount).toBe(550);

      // Test no breakdown found
      const calcNoBreakdown = {
        currency: 'usd',
        shipping_cost: {
          amount: 500,
          amount_tax: 50,
          tax_breakdown: []
        },
        tax_breakdown: []
      };
      const result4 = updateActionService.createShippingTaxUpdateAction(calcNoBreakdown);
      expect(result4).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        'No valid tax breakdown found for shipping cost after trying all 3 alternatives'
      );
    });
  });

  describe('findByDirectCalculation and findByExactAmount', () => {
    it('should find breakdown by direct calculation or exact amount match', () => {
      // Test findByDirectCalculation
      const baseAmount = 1000;
      const expectedTaxAmount = 100;
      const taxBreakdowns = [
        {
          tax_rate_details: {
            tax_type: 'sales_tax',
            percentage_decimal: '10.0',
            country: 'US'
          }
        }
      ];

      const result1 = updateActionService.findByDirectCalculation(
        baseAmount,
        expectedTaxAmount,
        taxBreakdowns
      );
      expect(result1).toBeDefined();
      expect(result1.tax_rate_details.tax_type).toBe('sales_tax');

      // Test no match
      const taxBreakdownsNoMatch = [
        {
          tax_rate_details: {
            tax_type: 'sales_tax',
            percentage_decimal: '5.0',
            country: 'US'
          }
        }
      ];
      expect(updateActionService.findByDirectCalculation(
        baseAmount,
        expectedTaxAmount,
        taxBreakdownsNoMatch
      )).toBeNull();

      // Test tolerance of 1 cent
      expect(updateActionService.findByDirectCalculation(
        baseAmount,
        expectedTaxAmount + 1,
        taxBreakdowns
      )).toBeDefined();

      // Test findByExactAmount
      const expectedAmount = 50;
      const shippingBreakdowns = [
        {
          amount: 50,
          tax_rate_details: {
            tax_type: 'shipping_tax',
            country: 'US'
          }
        }
      ];
      const generalBreakdowns = [];

      const result2 = updateActionService.findByExactAmount(
        expectedAmount,
        shippingBreakdowns,
        generalBreakdowns
      );
      expect(result2).toBeDefined();
      expect(result2.amount).toBe(50);

      // Test finding in general breakdowns
      const result3 = updateActionService.findByExactAmount(
        expectedAmount,
        [],
        shippingBreakdowns
      );
      expect(result3).toBeDefined();
      expect(result3.amount).toBe(50);

      // Test no match
      expect(updateActionService.findByExactAmount(
        50,
        [{ amount: 100, tax_rate_details: { tax_type: 'shipping_tax', country: 'US' } }],
        []
      )).toBeUndefined();

      // Test null breakdowns
      expect(updateActionService.findByExactAmount(50, null, null)).toBeUndefined();
    });
  });

  describe('createLineItemTaxUpdateActions - edge cases', () => {
    it('should create missing tax action when lineItemTotalPrice exists but no tax calculation', () => {
      const calculations = [];
      const shippingInfoGroups = [];
      const lineItemTotalPriceActions = [
        {
          action: 'setLineItemTotalPrice',
          lineItemId: 'line-item-1',
          shippingKey: 'shipping-key-1',
          externalTotalPrice: {
            totalPrice: {
              currencyCode: 'USD',
              centAmount: 1000
            }
          }
        }
      ];
      const cart = {
        country: 'US',
        shippingAddress: { country: 'US' },
        totalPrice: { currencyCode: 'USD' }
      };

      const result = updateActionService.createLineItemTaxUpdateActions(
        calculations,
        shippingInfoGroups,
        lineItemTotalPriceActions,
        cart
      );

      expect(result).toHaveLength(1);
      expect(result[0].action).toBe('setLineItemTaxAmount');
      expect(result[0].lineItemId).toBe('line-item-1');
      expect(result[0].externalTaxAmount.taxRate.amount).toBe(0);
      expect(result[0].externalTaxAmount.totalGross.centAmount).toBe(1000);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should handle duplicate line items with different rates and calculate effective rate', () => {
      const calculations = [
        {
          id: 'calc_1',
          currency: 'usd',
          line_items: {
            data: [
              {
                reference: 'line-item-1',
                amount: 1000,
                amount_tax: 100,
                metadata: { shippingKey: 'shipping-key-1' }
              }
            ]
          },
          tax_breakdown: [
            {
              tax_rate_details: {
                tax_type: 'sales_tax',
                percentage_decimal: '10.0',
                country: 'US'
              },
              amount: 100
            }
          ]
        },
        {
          id: 'calc_2',
          currency: 'usd',
          line_items: {
            data: [
              {
                reference: 'line-item-1',
                amount: 500,
                amount_tax: 25,
                metadata: { shippingKey: 'shipping-key-1' }
              }
            ]
          },
          tax_breakdown: [
            {
              tax_rate_details: {
                tax_type: 'sales_tax',
                percentage_decimal: '5.0',
                country: 'US'
              },
              amount: 25
            }
          ]
        }
      ];

      const shippingInfoGroups = [
        { shippingKey: 'shipping-key-1', lineItems: ['line-item-1'] },
        { shippingKey: 'shipping-key-1', lineItems: ['line-item-1'] }
      ];

      const lineItemTotalPriceActions = updateActionService.createLineItemTotalPriceActions(
        calculations,
        shippingInfoGroups
      );

      const result = updateActionService.createLineItemTaxUpdateActions(
        calculations,
        shippingInfoGroups,
        lineItemTotalPriceActions
      );

      expect(result).toHaveLength(1);
      // Combined: base=1500, tax=125, effective rate = 125/1500 = 0.0833...
      expect(result[0].externalTaxAmount.totalGross.centAmount).toBe(1625); // 1500 + 125
      expect(result[0].externalTaxAmount.taxRate.amount).toBeCloseTo(0.0833, 2);
    });

    it('should handle duplicate line items when totalBase is 0 and use average rate', () => {
      const calculations = [
        {
          id: 'calc_1',
          currency: 'usd',
          line_items: {
            data: [
              {
                reference: 'line-item-1',
                amount: 0,
                amount_tax: 0,
                metadata: { shippingKey: 'shipping-key-1' }
              }
            ]
          },
          tax_breakdown: [
            {
              tax_rate_details: {
                tax_type: 'sales_tax',
                percentage_decimal: '10.0',
                country: 'US'
              },
              amount: 0
            }
          ]
        },
        {
          id: 'calc_2',
          currency: 'usd',
          line_items: {
            data: [
              {
                reference: 'line-item-1',
                amount: 0,
                amount_tax: 0,
                metadata: { shippingKey: 'shipping-key-1' }
              }
            ]
          },
          tax_breakdown: [
            {
              tax_rate_details: {
                tax_type: 'sales_tax',
                percentage_decimal: '5.0',
                country: 'US'
              },
              amount: 0
            }
          ]
        }
      ];

      const shippingInfoGroups = [
        { shippingKey: 'shipping-key-1', lineItems: ['line-item-1'] },
        { shippingKey: 'shipping-key-1', lineItems: ['line-item-1'] }
      ];

      const lineItemTotalPriceActions = updateActionService.createLineItemTotalPriceActions(
        calculations,
        shippingInfoGroups
      );

      const result = updateActionService.createLineItemTaxUpdateActions(
        calculations,
        shippingInfoGroups,
        lineItemTotalPriceActions
      );

      expect(result).toHaveLength(1);
      // Average rate: (0.10 + 0.05) / 2 = 0.075
      expect(result[0].externalTaxAmount.taxRate.amount).toBeCloseTo(0.075, 5);
    });
  });

  describe('createMultipleShippingTaxUpdateActions - edge cases', () => {
    it('should handle empty shippingInfoGroups and no cart.shipping', () => {
      const calculations = [];
      const shippingInfoGroups = [];
      const cart = {};

      const result = updateActionService.createMultipleShippingTaxUpdateActions(
        calculations,
        shippingInfoGroups,
        [],
        cart
      );

      expect(result).toEqual([]);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should create zero tax action when no calculation found for shippingKey', () => {
      const calculations = [];
      const shippingInfoGroups = [
        { shippingKey: 'shipping-key-1', lineItems: [] }
      ];
      const cart = {
        shipping: [
          {
            shippingKey: 'shipping-key-1',
            shippingInfo: {
              price: { centAmount: 500 }
            }
          }
        ],
        totalPrice: { currencyCode: 'USD' }
      };

      const result = updateActionService.createMultipleShippingTaxUpdateActions(
        calculations,
        shippingInfoGroups,
        [],
        cart
      );

      expect(result).toHaveLength(1);
      expect(result[0].action).toBe('setShippingMethodTaxAmount');
      expect(result[0].shippingKey).toBe('shipping-key-1');
      expect(result[0].externalTaxAmount.totalGross.centAmount).toBe(500);
      expect(result[0].externalTaxAmount.taxRate.amount).toBe(0);
      expect(logger.info).toHaveBeenCalled();
    });

    it('should handle shipping method with no shippingInfo in cart', () => {
      const calculations = [];
      const shippingInfoGroups = [
        { shippingKey: 'shipping-key-1', lineItems: [] }
      ];
      const cart = {
        shipping: [
          {
            shippingKey: 'shipping-key-1'
          }
        ],
        totalPrice: { currencyCode: 'USD' }
      };

      const result = updateActionService.createMultipleShippingTaxUpdateActions(
        calculations,
        shippingInfoGroups,
        [],
        cart
      );

      expect(result).toHaveLength(1);
      expect(result[0].externalTaxAmount.totalGross.centAmount).toBe(0);
    });

    it('should combine shipping costs when multiple calculations share same shippingKey', () => {
      const calculations = [
        {
          id: 'calc_1',
          currency: 'usd',
          shipping_cost: {
            amount: 500,
            amount_tax: 50,
            tax_breakdown: [
              {
                tax_rate_details: {
                  tax_type: 'shipping_tax',
                  percentage_decimal: '10.0',
                  country: 'US'
                }
              }
            ]
          }
        },
        {
          id: 'calc_2',
          currency: 'usd',
          shipping_cost: {
            amount: 300,
            amount_tax: 30,
            tax_breakdown: [
              {
                tax_rate_details: {
                  tax_type: 'shipping_tax',
                  percentage_decimal: '10.0',
                  country: 'US'
                }
              }
            ]
          }
        }
      ];

      const shippingInfoGroups = [
        { shippingKey: 'shipping-key-1', lineItems: [] }
      ];

      const requests = [
        { shippingKey: 'shipping-key-1' },
        { shippingKey: 'shipping-key-1' }
      ];

      const cart = {
        shipping: [
          {
            shippingKey: 'shipping-key-1',
            shippingInfo: {
              price: { centAmount: 800 }
            }
          }
        ],
        totalPrice: { currencyCode: 'USD' }
      };

      const result = updateActionService.createMultipleShippingTaxUpdateActions(
        calculations,
        shippingInfoGroups,
        requests,
        cart
      );

      expect(result).toHaveLength(1);
      // Combined: amount=800, tax=80, totalGross=880
      expect(result[0].externalTaxAmount.totalGross.centAmount).toBe(880);
    });

    it('should handle calculation with no shippingInfo but shippingInfoGroups has shippingKey', () => {
      const calculations = [
        {
          id: 'calc_1',
          currency: 'usd',
          shipping_cost: null
        }
      ];

      const shippingInfoGroups = [
        { shippingKey: 'shipping-key-1', lineItems: [] }
      ];

      const cart = {
        shipping: [
          {
            shippingKey: 'shipping-key-1',
            shippingInfo: {
              price: { centAmount: 500 }
            }
          }
        ],
        totalPrice: { currencyCode: 'USD' }
      };

      const result = updateActionService.createMultipleShippingTaxUpdateActions(
        calculations,
        shippingInfoGroups,
        [],
        cart
      );

      expect(result).toHaveLength(1);
      expect(result[0].externalTaxAmount.taxRate.amount).toBe(0);
    });

    it('should use cart.shipping when shippingInfoGroups is empty', () => {
      const calculations = [];
      const shippingInfoGroups = [];
      const cart = {
        shipping: [
          {
            shippingKey: 'shipping-key-1',
            shippingInfo: {
              price: { centAmount: 500 }
            }
          }
        ],
        totalPrice: { currencyCode: 'USD' }
      };

      const result = updateActionService.createMultipleShippingTaxUpdateActions(
        calculations,
        shippingInfoGroups,
        [],
        cart
      );

      expect(result).toHaveLength(1);
      expect(result[0].shippingKey).toBe('shipping-key-1');
    });
  });

  describe('createZeroTaxShippingAction', () => {
    it('should create zero tax shipping action with shippingAmount from calculation', () => {
      const calculation = {
        currency: 'usd',
        shipping_cost: {
          amount: 500
        },
        tax_breakdown: []
      };
      const cart = { totalPrice: { currencyCode: 'USD' } };

      const result = updateActionService.createZeroTaxShippingAction(
        'shipping-key-1',
        calculation,
        cart,
        0
      );

      expect(result.action).toBe('setShippingMethodTaxAmount');
      expect(result.shippingKey).toBe('shipping-key-1');
      expect(result.externalTaxAmount.totalGross.centAmount).toBe(500);
      expect(result.externalTaxAmount.taxRate.amount).toBe(0);
    });

    it('should get shippingAmount from cart.shipping when calculation has none', () => {
      const cart = {
        shipping: [
          {
            shippingKey: 'shipping-key-1',
            shippingInfo: {
              price: { centAmount: 750 }
            }
          }
        ],
        totalPrice: { currencyCode: 'USD' }
      };

      const result = updateActionService.createZeroTaxShippingAction(
        'shipping-key-1',
        null,
        cart,
        0
      );

      expect(result.externalTaxAmount.totalGross.centAmount).toBe(750);
    });

    it('should get shippingAmount from cart.shippingInfo when shipping is not array', () => {
      const cart = {
        shipping: {
          shippingKey: 'shipping-key-1',
          shippingInfo: {
            price: { centAmount: 600 }
          }
        },
        totalPrice: { currencyCode: 'USD' }
      };

      const result = updateActionService.createZeroTaxShippingAction(
        'shipping-key-1',
        null,
        cart,
        0
      );

      expect(result.externalTaxAmount.totalGross.centAmount).toBe(600);
    });

    it('should use default country when calculation and cart have no country', () => {
      const result = updateActionService.createZeroTaxShippingAction(
        'shipping-key-1',
        null,
        { totalPrice: { currencyCode: 'USD' } },
        500
      );

      expect(result.externalTaxAmount.taxRate.country).toBe('US');
    });
  });

  describe('zero-tax labels name the destination, not cart.country (SB3-218)', () => {
    // These were the last three places in this service that produced a country without consulting
    // the calculation. Every one of them carries amount 0, so a wrong country never moved money —
    // but it recorded a jurisdiction the order was never bound for, from a field the shopper
    // controls. See destinationCountryOf.
    const calculationDeliveredToSpain = {
      id: 'calc_es',
      currency: 'eur',
      line_items: {
        data: [{ reference: 'line-item-1', amount: 10000, amount_tax: 0 }]
      },
      tax_breakdown: [],
      customer_details: { address: { country: 'ES' } }
    };
    const cartPricedInTheUS = {
      country: 'US',
      shippingAddress: { country: 'US' },
      totalPrice: { currencyCode: 'EUR' }
    };

    it('labels a line item that came back without a breakdown with the calculation destination', () => {
      const [action] = updateActionService.createLineItemActionsFromCalculation(
        calculationDeliveredToSpain,
        null
      );

      expect(action.externalTaxAmount.taxRate.amount).toBe(0);
      expect(action.externalTaxAmount.taxRate.country).toBe('ES');
    });

    it('labels a zero-tax shipping action with the calculation destination', () => {
      const action = updateActionService.createZeroTaxShippingAction(
        'shipping-key-1',
        calculationDeliveredToSpain,
        cartPricedInTheUS,
        500
      );

      expect(action.externalTaxAmount.taxRate.amount).toBe(0);
      expect(action.externalTaxAmount.taxRate.country).toBe('ES');
    });

    it('labels a line item that got no calculation at all with the destination of the ones that ran', () => {
      const lineItemTotalPriceActions = [
        {
          action: 'setLineItemTotalPrice',
          lineItemId: 'line-item-2',
          shippingKey: 'shipping-key-1',
          externalTotalPrice: { totalPrice: { currencyCode: 'EUR', centAmount: 1000 } }
        }
      ];

      const actions = updateActionService.createLineItemTaxUpdateActions(
        [calculationDeliveredToSpain],
        [],
        lineItemTotalPriceActions,
        cartPricedInTheUS
      );

      const missing = actions.find(action => action.lineItemId === 'line-item-2');
      expect(missing.externalTaxAmount.taxRate.amount).toBe(0);
      expect(missing.externalTaxAmount.taxRate.country).toBe('ES');
    });

    it('falls back to the documented default rather than to cart.country when nothing names a destination', () => {
      const action = updateActionService.createZeroTaxShippingAction(
        'shipping-key-1',
        { currency: 'usd', tax_breakdown: [] },
        { country: 'ES', totalPrice: { currencyCode: 'USD' } },
        500
      );

      expect(action.externalTaxAmount.taxRate.country).toBe('US');
    });
  });

  describe('mapCalculationsToShippingKeys', () => {
    it('should extract shippingKey from line item metadata', () => {
      const calculations = [
        {
          id: 'calc_1',
          line_items: {
            data: [
              {
                reference: 'line-item-1',
                metadata: { shippingKey: 'shipping-key-1' }
              }
            ]
          }
        }
      ];

      const shippingInfoGroups = [];

      const result = updateActionService.mapCalculationsToShippingKeys(
        calculations,
        shippingInfoGroups
      );

      expect(result.get('calc_1')).toBe('shipping-key-1');
    });

    it('should fallback to shippingInfoGroups when metadata is not available', () => {
      const calculations = [
        {
          id: 'calc_1',
          line_items: {
            data: [
              {
                reference: 'line-item-1'
              }
            ]
          }
        }
      ];

      const shippingInfoGroups = [
        { shippingKey: 'shipping-key-1', lineItems: [] }
      ];

      const result = updateActionService.mapCalculationsToShippingKeys(
        calculations,
        shippingInfoGroups
      );

      expect(result.get('calc_1')).toBe('shipping-key-1');
    });
  });

  describe('combineShippingCosts', () => {
    it('should combine shipping costs from multiple calculations', () => {
      const existing = {
        calculation: {
          shipping_cost: {
            amount: 500,
            amount_tax: 50,
            tax_breakdown: [{ amount: 50 }]
          },
          tax_breakdown: []
        }
      };

      const calculation = {
        shipping_cost: {
          amount: 300,
          amount_tax: 30,
          tax_breakdown: [{ amount: 30 }]
        },
        tax_breakdown: []
      };

      updateActionService.combineShippingCosts(existing, calculation);

      expect(existing.calculation.shipping_cost.amount).toBe(800);
      expect(existing.calculation.shipping_cost.amount_tax).toBe(80);
      expect(existing.calculation.shipping_cost.tax_breakdown).toHaveLength(2);
    });

    it('should set shipping_cost when existing has none', () => {
      const existing = {
        calculation: {
          tax_breakdown: []
        }
      };

      const calculation = {
        shipping_cost: {
          amount: 500,
          amount_tax: 50
        }
      };

      updateActionService.combineShippingCosts(existing, calculation);

      expect(existing.calculation.shipping_cost).toBeDefined();
      expect(existing.calculation.shipping_cost.amount).toBe(500);
    });
  });

  describe('findOrCreateShippingTaxBreakdown', () => {
    it('should find breakdown in shipping_cost.tax_breakdown', () => {
      const calculation = {
        shipping_cost: {
          amount: 500,
          amount_tax: 50,
          tax_breakdown: [
            {
              tax_rate_details: {
                tax_type: 'shipping_tax',
                percentage_decimal: '10.0',
                country: 'US'
              },
              amount: 50
            }
          ]
        },
        tax_breakdown: []
      };

      const result = updateActionService.findOrCreateShippingTaxBreakdown(
        calculation,
        500,
        50
      );

      expect(result).toBeDefined();
      expect(result.tax_rate_details.tax_type).toBe('shipping_tax');
    });

    it('should find breakdown in general tax_breakdown when shipping_cost has none', () => {
      const calculation = {
        shipping_cost: {
          amount: 500,
          amount_tax: 50,
          tax_breakdown: []
        },
        tax_breakdown: [
          {
            tax_rate_details: {
              tax_type: 'sales_tax',
              percentage_decimal: '10.0',
              country: 'US'
            },
            amount: 50
          }
        ]
      };

      const result = updateActionService.findOrCreateShippingTaxBreakdown(
        calculation,
        500,
        50
      );

      expect(result).toBeDefined();
    });

    it('should create breakdown when none found but amounts are positive', () => {
      const calculation = {
        shipping_cost: {
          amount: 500,
          amount_tax: 50,
          tax_breakdown: []
        },
        tax_breakdown: [
          {
            tax_rate_details: {
              tax_type: 'sales_tax',
              percentage_decimal: '10.0',
              country: 'US'
            }
          }
        ]
      };

      const result = updateActionService.findOrCreateShippingTaxBreakdown(
        calculation,
        500,
        50
      );

      expect(result).toBeDefined();
      // findByDirectCalculation should find the breakdown since 500 * 0.10 = 50
      // The breakdown may or may not have amount, depending on the original breakdown structure
      expect(result.tax_rate_details).toBeDefined();
      expect(result.tax_rate_details.tax_type).toBe('sales_tax');
      expect(parseFloat(result.tax_rate_details.percentage_decimal)).toBeCloseTo(10.0, 1);
    });
  });
});
