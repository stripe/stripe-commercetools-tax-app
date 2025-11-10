// tax-calculator/test/unit/update-action.service.spec.js
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
      expect(result1[0].action).toBe('setCustomType');
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
        'Error creating cart update actions from multiple calculations:',
        expect.any(Error)
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
      expect(result.currencies).toEqual(['USD', 'USD']);
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

  describe('createCartCustomTypeUpdateAction', () => {
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

      const result1 = updateActionService.createLineItemTaxUpdateActions(calculations, shippingInfoGroups);
      expect(result1).toBeInstanceOf(Array);
      expect(result1.length).toBeGreaterThan(0);
      expect(result1[0].action).toBe('setLineItemTaxAmount');
      expect(result1[0].lineItemId).toBe('line-item-1');
      expect(logger.info).toHaveBeenCalled();

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

      const result2 = updateActionService.createLineItemTaxUpdateActions(
        duplicateCalculations,
        duplicateShippingGroups
      );
      expect(result2.length).toBe(1);
      expect(result2[0].externalTaxAmount.totalGross.centAmount).toBe(200);

      // Test without shipping info groups
      const result3 = updateActionService.createLineItemTaxUpdateActions(calculations);
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

      // Test with shippingKey
      const result1 = updateActionService.createLineItemActionsFromCalculation(calculation, 'shipping-key-1');
      expect(result1).toHaveLength(1);
      expect(result1[0].action).toBe('setLineItemTaxAmount');
      expect(result1[0].lineItemId).toBe('line-item-1');
      expect(result1[0].shippingKey).toBe('shipping-key-1');
      expect(result1[0].externalTaxAmount.totalGross.centAmount).toBe(100);
      expect(result1[0].externalTaxAmount.taxRate.name).toBe('sales_tax');
      expect(result1[0].externalTaxAmount.taxRate.amount).toBe(0.1);

      // Test without shippingKey
      const result2 = updateActionService.createLineItemActionsFromCalculation(calculation);
      expect(result2[0].shippingKey).toBeUndefined();

      // Test without line items
      const calcNoLineItems = {
        id: 'calc_123',
        currency: 'usd',
        line_items: { data: [] },
        tax_breakdown: []
      };
      expect(updateActionService.createLineItemActionsFromCalculation(calcNoLineItems)).toHaveLength(0);

      // Test without tax breakdown
      const calcNoBreakdown = {
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
        tax_breakdown: []
      };
      const result3 = updateActionService.createLineItemActionsFromCalculation(calcNoBreakdown);
      expect(result3).toHaveLength(0);
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
      const result4 = updateActionService.createLineItemActionsFromCalculation(calcNoCurrency);
      expect(result4[0].externalTaxAmount.totalGross.currencyCode).toBe('USD');
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
      expect(updateActionService.findTaxBreakdownForLineItem(lineItemTaxData, [])).toBeUndefined();

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
      expect(result1[0].externalTaxAmount.totalGross.centAmount).toBe(50);
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
      expect(result2[0].externalTaxAmount.totalGross.centAmount).toBe(0);
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
      expect(result3[0].externalTaxAmount.totalGross.centAmount).toBe(0);
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
      expect(result1.externalTaxAmount.totalGross.centAmount).toBe(50);
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
      expect(result2.externalTaxAmount.totalGross.centAmount).toBe(0);
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
      expect(result3.externalTaxAmount.totalGross.centAmount).toBe(50);

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
        taxBreakdowns,
        'test'
      );
      expect(result1).toBeDefined();
      expect(result1.tax_rate_details.tax_type).toBe('sales_tax');
      expect(logger.info).toHaveBeenCalled();

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
        taxBreakdownsNoMatch,
        'test'
      )).toBeNull();

      // Test tolerance of 1 cent
      expect(updateActionService.findByDirectCalculation(
        baseAmount,
        expectedTaxAmount + 1,
        taxBreakdowns,
        'test'
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
      expect(logger.info).toHaveBeenCalled();

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
});
