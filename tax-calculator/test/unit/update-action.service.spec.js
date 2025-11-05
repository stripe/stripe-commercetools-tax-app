import { expect, describe, it, jest, beforeEach, afterEach } from '@jest/globals';

// Mock the dependencies
jest.mock('../../src/utils/logger.utils.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

jest.mock('../../src/connectors/customTypes.js', () => ({
  CART_TAX_CUSTOM_TYPE: {
    key: 'connector-stripe-tax-calculation-reference'
  },
  CART_TAX_FIELD_NAMES: {
    CALCULATION_REFERENCE: 'connectorStripeTax_calculationReference',
    AMOUNT_TOTAL: 'connectorStripeTax_amountTotal',
    TAX_AMOUNT_EXCLUSIVE: 'connectorStripeTax_taxAmountExclusive',
    TAX_AMOUNT_INCLUSIVE: 'connectorStripeTax_taxAmountInclusive',
    CURRENCY: 'connectorStripeTax_currency',
    EXPIRES_AT: 'connectorStripeTax_expiresAt',
    CALCULATION_TIMESTAMP: 'connectorStripeTax_calculationTimestamp'
  }
}));

import { logger } from '../../src/utils/logger.utils.js';
import { CART_TAX_CUSTOM_TYPE, CART_TAX_FIELD_NAMES } from '../../src/connectors/customTypes.js';
import UpdateActionService from '../../src/services/update-action.service.js';

describe('UpdateActionService', () => {
  let service;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Get the service instance
    service = UpdateActionService;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createCartUpdateActionsFromTaxCalculation', () => {
    const mockTaxCalculation = {
      id: 'calc_123',
      amount_total: 1000,
      tax_amount_exclusive: 100,
      tax_amount_inclusive: 1100,
      currency: 'usd',
      expires_at: 1234567890,
      line_items: {
        data: [
          {
            reference: 'line-item-1',
            amount: 500,
            amount_tax: 50
          },
          {
            reference: 'line-item-2',
            amount: 500,
            amount_tax: 50
          }
        ]
      },
      tax_breakdown: [
        {
          amount: 100,
          tax_rate_details: {
            tax_type: 'VAT',
            percentage_decimal: '10.0',
            country: 'US'
          }
        }
      ],
      shipping_cost: {
        amount: 200,
        amount_tax: 20,
        tax_breakdown: [
          {
            amount: 20,
            tax_rate_details: {
              tax_type: 'Shipping Tax',
              percentage_decimal: '10.0',
              country: 'US'
            }
          }
        ]
      }
    };

    it('should create all update actions successfully', () => {
      // Act
      const result = service.createCartUpdateActionsFromTaxCalculation(mockTaxCalculation);

      // Assert
      expect(result).toHaveLength(4); // 1 cart custom type + 2 line items + 1 shipping
      expect(logger.info).toHaveBeenCalledWith('Created 4 cart update actions from tax calculation');
    });

    it('should handle calculation without shipping cost', () => {
      // Arrange
      const calculationWithoutShipping = {
        ...mockTaxCalculation,
        shipping_cost: null
      };

      // Act
      const result = service.createCartUpdateActionsFromTaxCalculation(calculationWithoutShipping);

      // Assert
      expect(result).toHaveLength(3); // 1 cart custom type + 2 line items
      expect(logger.info).toHaveBeenCalledWith('Created 3 cart update actions from tax calculation');
    });

    it('should handle calculation with zero shipping tax', () => {
      // Arrange
      const calculationWithZeroShipping = {
        ...mockTaxCalculation,
        shipping_cost: {
          amount: 200,
          amount_tax: 0
        }
      };

      // Act
      const result = service.createCartUpdateActionsFromTaxCalculation(calculationWithZeroShipping);

      // Assert
      expect(result).toHaveLength(3); // 1 cart custom type + 2 line items
    });

    it('should handle error and rethrow it', () => {
      // Arrange
      const invalidCalculation = null;

      // Act & Assert
      expect(() => {
        service.createCartUpdateActionsFromTaxCalculation(invalidCalculation);
      }).toThrow();

      expect(logger.error).toHaveBeenCalledWith('Error creating cart update actions:', expect.any(Error));
    });
  });

  describe('createCartCustomTypeUpdateAction', () => {
    const mockCalculation = {
      id: 'calc_123',
      amount_total: 1000,
      tax_amount_exclusive: 100,
      tax_amount_inclusive: 1100,
      currency: 'usd',
      expires_at: 1234567890
    };

    it('should create cart custom type update action with correct structure', () => {
      // Act
      const result = service.createCartCustomTypeUpdateAction(mockCalculation);

      // Assert
      expect(result).toEqual({
        action: 'setCustomType',
        type: {
          key: CART_TAX_CUSTOM_TYPE.key,
          typeId: 'type'
        },
        fields: {
          [CART_TAX_FIELD_NAMES.CALCULATION_REFERENCE]: 'calc_123',
          [CART_TAX_FIELD_NAMES.AMOUNT_TOTAL]: 1000,
          [CART_TAX_FIELD_NAMES.TAX_AMOUNT_EXCLUSIVE]: 100,
          [CART_TAX_FIELD_NAMES.TAX_AMOUNT_INCLUSIVE]: 1100,
          [CART_TAX_FIELD_NAMES.CURRENCY]: 'usd',
          [CART_TAX_FIELD_NAMES.EXPIRES_AT]: 1234567890,
          [CART_TAX_FIELD_NAMES.CALCULATION_TIMESTAMP]: expect.any(String)
        }
      });
    });

    it('should include current timestamp in calculation timestamp', () => {
      // Arrange
      const beforeCall = new Date().toISOString();

      // Act
      const result = service.createCartCustomTypeUpdateAction(mockCalculation);

      // Assert
      const afterCall = new Date().toISOString();
      const timestamp = result.fields[CART_TAX_FIELD_NAMES.CALCULATION_TIMESTAMP];
      
      expect(timestamp).toBeDefined();
      expect(new Date(timestamp).getTime()).toBeGreaterThanOrEqual(new Date(beforeCall).getTime());
      expect(new Date(timestamp).getTime()).toBeLessThanOrEqual(new Date(afterCall).getTime());
    });
  });

  describe('createLineItemTaxUpdateActions', () => {
    const mockCalculation = {
      line_items: {
        data: [
          {
            reference: 'line-item-1',
            amount: 500,
            amount_tax: 50
          },
          {
            reference: 'line-item-2',
            amount: 500,
            amount_tax: 50
          }
        ]
      },
      tax_breakdown: [
        {
          amount: 100,
          tax_rate_details: {
            tax_type: 'VAT',
            percentage_decimal: '10.0',
            country: 'US'
          }
        }
      ],
      currency: 'usd'
    };

    it('should create line item tax update actions for all line items', () => {
      // Act
      const result = service.createLineItemTaxUpdateActions(mockCalculation);

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        action: 'setLineItemTaxAmount',
        lineItemId: 'line-item-1',
        externalTaxAmount: {
          totalGross: {
            currencyCode: 'USD',
            centAmount: 50
          },
          taxRate: {
            name: 'VAT',
            amount: 0.1,
            country: 'US'
          }
        }
      });
    });

    it('should handle empty line items array', () => {
      // Arrange
      const calculationWithNoLineItems = {
        ...mockCalculation,
        line_items: { data: [] }
      };

      // Act
      const result = service.createLineItemTaxUpdateActions(calculationWithNoLineItems);

      // Assert
      expect(result).toHaveLength(0);
      expect(logger.warn).toHaveBeenCalledWith('No line items found in tax calculation');
    });

    it('should handle missing line items', () => {
      // Arrange
      const calculationWithNoLineItems = {
        ...mockCalculation,
        line_items: null
      };

      // Act
      const result = service.createLineItemTaxUpdateActions(calculationWithNoLineItems);

      // Assert
      expect(result).toHaveLength(0);
      expect(logger.warn).toHaveBeenCalledWith('No line items found in tax calculation');
    });

    it('should continue processing when one line item fails', () => {
      // Arrange
      const calculationWithOneInvalidItem = {
        ...mockCalculation,
        line_items: {
          data: [
            {
              reference: 'line-item-1',
              amount: 500,
              amount_tax: 50
            },
            {
              reference: 'invalid-item',
              amount: 500,
              amount_tax: 50
            }
          ]
        },
        tax_breakdown: [] // This will cause the second item to fail
      };

      // Act
      const result = service.createLineItemTaxUpdateActions(calculationWithOneInvalidItem);

      // Assert
      expect(result).toHaveLength(0); // Both items will fail due to empty tax breakdown
      expect(logger.warn).toHaveBeenCalledWith('No tax breakdown found for line item line-item-1');
      expect(logger.warn).toHaveBeenCalledWith('No tax breakdown found for line item invalid-item');
    });
  });

  describe('buildLineItemTaxUpdateAction', () => {
    const mockLineItemTaxData = {
      reference: 'line-item-1',
      amount: 500,
      amount_tax: 50
    };

    const mockTaxBreakdowns = [
      {
        amount: 100,
        tax_rate_details: {
          tax_type: 'VAT',
          percentage_decimal: '10.0',
          country: 'US'
        }
      }
    ];

    it('should create line item tax update action with correct structure', () => {
      // Act
      const result = service.buildLineItemTaxUpdateAction(mockLineItemTaxData, mockTaxBreakdowns, 'usd');

      // Assert
      expect(result).toEqual({
        action: 'setLineItemTaxAmount',
        lineItemId: 'line-item-1',
        externalTaxAmount: {
          totalGross: {
            currencyCode: 'USD',
            centAmount: 50
          },
          taxRate: {
            name: 'VAT',
            amount: 0.1,
            country: 'US'
          }
        }
      });
    });

    it('should handle missing tax breakdown and return null', () => {
      // Arrange
      const emptyTaxBreakdowns = [];

      // Act
      const result = service.buildLineItemTaxUpdateAction(mockLineItemTaxData, emptyTaxBreakdowns, 'usd');

      // Assert
      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith('No tax breakdown found for line item line-item-1');
    });

    it('should handle missing tax rate details', () => {
      // Arrange
      const taxBreakdownsWithoutDetails = [
        {
          amount: 100,
          tax_rate_details: null
        }
      ];

      // Act
      const result = service.buildLineItemTaxUpdateAction(mockLineItemTaxData, taxBreakdownsWithoutDetails, 'usd');

      // Assert
      expect(result).toBeNull();
    });

    it('should use default tax type when not provided', () => {
      // Arrange
      const taxBreakdownsWithoutTaxType = [
        {
          amount: 100,
          tax_rate_details: {
            percentage_decimal: '10.0',
            country: 'US'
          }
        }
      ];

      // Act
      const result = service.buildLineItemTaxUpdateAction(mockLineItemTaxData, taxBreakdownsWithoutTaxType, 'usd');

      // Assert
      expect(result.externalTaxAmount.taxRate.name).toBe('Tax');
    });

    it('should handle missing percentage decimal', () => {
      // Arrange
      const taxBreakdownsWithoutPercentage = [
        {
          amount: 100,
          tax_rate_details: {
            tax_type: 'VAT',
            country: 'US'
          }
        }
      ];

      // Act
      const result = service.buildLineItemTaxUpdateAction(mockLineItemTaxData, taxBreakdownsWithoutPercentage, 'usd');

      // Assert
      expect(result.externalTaxAmount.taxRate.amount).toBe(0);
    });
  });

  describe('createShippingTaxUpdateAction', () => {
    const mockCalculation = {
      currency: 'usd',
      shipping_cost: {
        amount: 200,
        amount_tax: 20,
        tax_breakdown: [
          {
            amount: 20,
            tax_rate_details: {
              tax_type: 'Shipping Tax',
              percentage_decimal: '10.0',
              country: 'US'
            }
          }
        ]
      },
      tax_breakdown: [
        {
          amount: 100,
          tax_rate_details: {
            tax_type: 'VAT',
            percentage_decimal: '10.0',
            country: 'US'
          }
        }
      ]
    };

    it('should create shipping tax update action when shipping cost exists', () => {
      // Act
      const result = service.createShippingTaxUpdateAction(mockCalculation);

      // Assert
      expect(result).toEqual({
        action: 'setShippingMethodTaxAmount',
        externalTaxAmount: {
          totalGross: {
            currencyCode: 'USD',
            centAmount: 20
          },
          taxRate: {
            name: 'Shipping Tax',
            amount: 0.1,
            country: undefined
          }
        }
      });
    });

    it('should return null when shipping cost is null', () => {
      // Arrange
      const calculationWithoutShipping = {
        ...mockCalculation,
        shipping_cost: null
      };

      // Act
      const result = service.createShippingTaxUpdateAction(calculationWithoutShipping);

      // Assert
      expect(result).toBeNull();
    });

    it('should return null when shipping tax amount is zero or negative', () => {
      // Arrange
      const calculationWithZeroShipping = {
        ...mockCalculation,
        shipping_cost: {
          amount: 200,
          amount_tax: 0
        }
      };

      // Act
      const result = service.createShippingTaxUpdateAction(calculationWithZeroShipping);

      // Assert
      expect(result).toBeNull();
    });

    it('should return null when no valid tax breakdown is found', () => {
      // Arrange
      const calculationWithoutValidBreakdown = {
        ...mockCalculation,
        shipping_cost: {
          amount: 200,
          amount_tax: 20,
          tax_breakdown: []
        },
        tax_breakdown: []
      };

      // Act
      const result = service.createShippingTaxUpdateAction(calculationWithoutValidBreakdown);

      // Assert
      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith('No valid tax breakdown found for shipping cost after trying all 3 alternatives');
    });
  });

  describe('findTaxBreakdownForLineItem', () => {
    const mockLineItemTaxData = {
      reference: 'line-item-1',
      amount: 500,
      amount_tax: 50
    };

    it('should find tax breakdown by calculated tax amount', () => {
      // Arrange
      const taxBreakdowns = [
        {
          amount: 100,
          tax_rate_details: {
            tax_type: 'VAT',
            percentage_decimal: '10.0',
            country: 'US'
          }
        }
      ];

      // Act
      const result = service.findTaxBreakdownForLineItem(mockLineItemTaxData, taxBreakdowns);

      // Assert
      expect(result).toEqual(taxBreakdowns[0]);
    });

    it('should find tax breakdown by most common tax type when direct calculation fails', () => {
      // Arrange
      const taxBreakdowns = [
        {
          amount: 100,
          tax_rate_details: {
            tax_type: 'VAT',
            percentage_decimal: '5.0', // This won't match the calculated amount
            country: 'US'
          }
        },
        {
          amount: 200,
          tax_rate_details: {
            tax_type: 'Sales Tax',
            percentage_decimal: '8.0',
            country: 'US'
          }
        },
        {
          amount: 300,
          tax_rate_details: {
            tax_type: 'Sales Tax',
            percentage_decimal: '8.0',
            country: 'US'
          }
        }
      ];

      // Act
      const result = service.findTaxBreakdownForLineItem(mockLineItemTaxData, taxBreakdowns);

      // Assert
      expect(result).toEqual(taxBreakdowns[1]); // Should return the first "Sales Tax" entry
    });

    it('should return null when no tax breakdowns are provided', () => {
      // Act
      const result = service.findTaxBreakdownForLineItem(mockLineItemTaxData, []);

      // Assert
      expect(result).toBeUndefined();
    });

    it('should handle tax breakdowns without percentage decimal', () => {
      // Arrange
      const taxBreakdowns = [
        {
          amount: 100,
          tax_rate_details: {
            tax_type: 'VAT',
            country: 'US'
            // percentage_decimal is missing
          }
        }
      ];

      // Act
      const result = service.findTaxBreakdownForLineItem(mockLineItemTaxData, taxBreakdowns);

      // Assert
      expect(result).toEqual(taxBreakdowns[0]); // Should return the breakdown by most common tax type
    });
  });

  describe('findByDirectCalculation', () => {
    it('should find tax breakdown by direct calculation', () => {
      // Arrange
      const baseAmount = 1000;
      const expectedTaxAmount = 100;
      const taxBreakdowns = [
        {
          amount: 100,
          tax_rate_details: {
            tax_type: 'VAT',
            percentage_decimal: '10.0',
            country: 'US'
          }
        }
      ];

      // Act
      const result = service.findByDirectCalculation(baseAmount, expectedTaxAmount, taxBreakdowns, 'test');

      // Assert
      expect(result).toEqual(taxBreakdowns[0]);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Found test tax breakdown by direct calculation')
      );
    });

    it('should return null when no matching breakdown is found', () => {
      // Arrange
      const baseAmount = 1000;
      const expectedTaxAmount = 100;
      const taxBreakdowns = [
        {
          amount: 100,
          tax_rate_details: {
            tax_type: 'VAT',
            percentage_decimal: '5.0', // This won't match
            country: 'US'
          }
        }
      ];

      // Act
      const result = service.findByDirectCalculation(baseAmount, expectedTaxAmount, taxBreakdowns, 'test');

      // Assert
      expect(result).toBeNull();
    });

    it('should return null when tax breakdowns array is empty', () => {
      // Act
      const result = service.findByDirectCalculation(1000, 100, [], 'test');

      // Assert
      expect(result).toBeNull();
    });

    it('should return null when tax breakdowns is null', () => {
      // Act
      const result = service.findByDirectCalculation(1000, 100, null, 'test');

      // Assert
      expect(result).toBeNull();
    });

    it('should handle tax breakdowns without percentage decimal', () => {
      // Arrange
      const baseAmount = 1000;
      const expectedTaxAmount = 100;
      const taxBreakdowns = [
        {
          amount: 100,
          tax_rate_details: {
            tax_type: 'VAT',
            country: 'US'
            // percentage_decimal is missing
          }
        }
      ];

      // Act
      const result = service.findByDirectCalculation(baseAmount, expectedTaxAmount, taxBreakdowns, 'test');

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('findByExactAmount', () => {
    it('should find tax breakdown by exact amount in shipping breakdowns', () => {
      // Arrange
      const expectedAmount = 100;
      const shippingBreakdowns = [
        {
          amount: 100,
          tax_rate_details: {
            tax_type: 'Shipping Tax',
            percentage_decimal: '10.0',
            country: 'US'
          }
        }
      ];
      const generalBreakdowns = [
        {
          amount: 200,
          tax_rate_details: {
            tax_type: 'VAT',
            percentage_decimal: '10.0',
            country: 'US'
          }
        }
      ];

      // Act
      const result = service.findByExactAmount(expectedAmount, shippingBreakdowns, generalBreakdowns);

      // Assert
      expect(result).toEqual(shippingBreakdowns[0]);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Found tax breakdown by exact amount')
      );
    });

    it('should find tax breakdown by exact amount in general breakdowns when shipping is empty', () => {
      // Arrange
      const expectedAmount = 200;
      const shippingBreakdowns = [];
      const generalBreakdowns = [
        {
          amount: 200,
          tax_rate_details: {
            tax_type: 'VAT',
            percentage_decimal: '10.0',
            country: 'US'
          }
        }
      ];

      // Act
      const result = service.findByExactAmount(expectedAmount, shippingBreakdowns, generalBreakdowns);

      // Assert
      expect(result).toEqual(generalBreakdowns[0]);
    });

    it('should return null when no matching amount is found', () => {
      // Arrange
      const expectedAmount = 300;
      const shippingBreakdowns = [
        {
          amount: 100,
          tax_rate_details: {
            tax_type: 'Shipping Tax',
            percentage_decimal: '10.0',
            country: 'US'
          }
        }
      ];
      const generalBreakdowns = [
        {
          amount: 200,
          tax_rate_details: {
            tax_type: 'VAT',
            percentage_decimal: '10.0',
            country: 'US'
          }
        }
      ];

      // Act
      const result = service.findByExactAmount(expectedAmount, shippingBreakdowns, generalBreakdowns);

      // Assert
      expect(result).toBeUndefined();
    });

    it('should handle null breakdowns arrays', () => {
      // Act
      const result = service.findByExactAmount(100, null, null);

      // Assert
      expect(result).toBeUndefined();
    });
  });

  describe('validateTaxCalculation', () => {
    it('should return valid result for complete tax calculation', () => {
      // Arrange
      const validCalculation = {
        id: 'calc_123',
        currency: 'usd',
        tax_breakdown: [{ amount: 100 }],
        line_items: { data: [{ reference: 'item-1' }] }
      };

      // Act
      const result = service.validateTaxCalculation(validCalculation);

      // Assert
      expect(result).toEqual({
        isValid: true,
        errors: []
      });
    });

    it('should return invalid result when calculation ID is missing', () => {
      // Arrange
      const invalidCalculation = {
        currency: 'usd',
        tax_breakdown: [{ amount: 100 }],
        line_items: { data: [{ reference: 'item-1' }] }
      };

      // Act
      const result = service.validateTaxCalculation(invalidCalculation);

      // Assert
      expect(result).toEqual({
        isValid: false,
        errors: ['Missing calculation ID']
      });
    });

    it('should return invalid result when currency is missing', () => {
      // Arrange
      const invalidCalculation = {
        id: 'calc_123',
        tax_breakdown: [{ amount: 100 }],
        line_items: { data: [{ reference: 'item-1' }] }
      };

      // Act
      const result = service.validateTaxCalculation(invalidCalculation);

      // Assert
      expect(result).toEqual({
        isValid: false,
        errors: ['Missing currency']
      });
    });

    it('should return invalid result when tax breakdown is missing', () => {
      // Arrange
      const invalidCalculation = {
        id: 'calc_123',
        currency: 'usd',
        line_items: { data: [{ reference: 'item-1' }] }
      };

      // Act
      const result = service.validateTaxCalculation(invalidCalculation);

      // Assert
      expect(result).toEqual({
        isValid: false,
        errors: ['No tax breakdown available']
      });
    });

    it('should return invalid result when tax breakdown is empty', () => {
      // Arrange
      const invalidCalculation = {
        id: 'calc_123',
        currency: 'usd',
        tax_breakdown: [],
        line_items: { data: [{ reference: 'item-1' }] }
      };

      // Act
      const result = service.validateTaxCalculation(invalidCalculation);

      // Assert
      expect(result).toEqual({
        isValid: false,
        errors: ['No tax breakdown available']
      });
    });

    it('should return invalid result when line items are missing', () => {
      // Arrange
      const invalidCalculation = {
        id: 'calc_123',
        currency: 'usd',
        tax_breakdown: [{ amount: 100 }]
      };

      // Act
      const result = service.validateTaxCalculation(invalidCalculation);

      // Assert
      expect(result).toEqual({
        isValid: false,
        errors: ['No line items available']
      });
    });

    it('should return invalid result when line items data is empty', () => {
      // Arrange
      const invalidCalculation = {
        id: 'calc_123',
        currency: 'usd',
        tax_breakdown: [{ amount: 100 }],
        line_items: { data: [] }
      };

      // Act
      const result = service.validateTaxCalculation(invalidCalculation);

      // Assert
      expect(result).toEqual({
        isValid: false,
        errors: ['No line items available']
      });
    });

    it('should return invalid result with multiple errors', () => {
      // Arrange
      const invalidCalculation = {};

      // Act
      const result = service.validateTaxCalculation(invalidCalculation);

      // Assert
      expect(result).toEqual({
        isValid: false,
        errors: [
          'Missing calculation ID',
          'Missing currency',
          'No tax breakdown available',
          'No line items available'
        ]
      });
    });
  });
});
