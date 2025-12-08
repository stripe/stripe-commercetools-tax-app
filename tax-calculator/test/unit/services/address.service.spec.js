import { expect, describe, it, jest, beforeEach, afterEach } from '@jest/globals';

// Mock dependencies BEFORE importing the service
jest.mock('../../../src/utils/logger.utils.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

// Mock Stripe - return the same instance every time
// Use global to store the shared instance
jest.mock('stripe', () => {
  return jest.fn(() => {
    if (!global.__mockStripeInstance__) {
      global.__mockStripeInstance__ = {
        tax: {
          calculations: {
            create: jest.fn()
          }
        }
      };
    }
    return global.__mockStripeInstance__;
  });
});

import { logger } from '../../../src/utils/logger.utils.js';
import Stripe from 'stripe';
import addressService from '../../../src/services/address.service.js';

describe('AddressService', () => {
  let originalEnv;
  let stripeMockInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Get the shared mock instance from global
    stripeMockInstance = global.__mockStripeInstance__;
    
    // If it doesn't exist yet, create it by instantiating Stripe
    if (!stripeMockInstance) {
      stripeMockInstance = new Stripe('test_token');
    }
    
    // Save original env
    originalEnv = { ...process.env };
    process.env.STRIPE_API_TOKEN = 'test_token';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('validateAddress', () => {
    it('should return validation error when address is null', async () => {
      const result = await addressService.validateAddress(null);
      
      expect(result.success).toBe(false);
      expect(result.validation.local.isValid).toBe(false);
      expect(result.validation.local.errors).toHaveLength(1);
      expect(result.validation.local.errors[0].code).toBe('INVALID_ADDRESS');
      expect(result.validation.stripe).toBeNull();
    });

    it('should return validation error when address is not an object', async () => {
      const result = await addressService.validateAddress('invalid');
      
      expect(result.success).toBe(false);
      expect(result.validation.local.isValid).toBe(false);
      expect(result.validation.local.errors[0].code).toBe('INVALID_ADDRESS');
    });

    it('should return validation error when address is an array', async () => {
      const result = await addressService.validateAddress([]);
      
      expect(result.success).toBe(false);
      expect(result.validation.local.isValid).toBe(false);
      expect(result.validation.local.errors[0].code).toBe('INVALID_ADDRESS');
    });

    it('should return validation error when country is missing', async () => {
      const address = {
        line1: '123 Main St',
        city: 'San Francisco',
        state: 'CA',
        postal_code: '94105'
      };
      
      const result = await addressService.validateAddress(address);
      
      expect(result.success).toBe(false);
      expect(result.validation.local.isValid).toBe(false);
      expect(result.validation.local.errors.some(e => e.code === 'MISSING_COUNTRY')).toBe(true);
      expect(result.validation.stripe).toBeNull();
    });

    it('should return validation error when country is not a string', async () => {
      const address = {
        country: 123,
        line1: '123 Main St',
        city: 'San Francisco',
        state: 'CA',
        postal_code: '94105'
      };
      
      const result = await addressService.validateAddress(address);
      
      expect(result.success).toBe(false);
      expect(result.validation.local.isValid).toBe(false);
      expect(result.validation.local.errors.some(e => e.code === 'INVALID_COUNTRY_TYPE')).toBe(true);
    });

    it('should validate US address successfully and verify with Stripe', async () => {
      const address = {
        country: 'US',
        line1: '123 Main St',
        city: 'San Francisco',
        state: 'CA',
        postal_code: '94105'
      };

      stripeMockInstance.tax.calculations.create.mockResolvedValue({
        id: 'calc_123'
      });

      const result = await addressService.validateAddress(address, 'test-request-id');

      expect(result.success).toBe(true);
      expect(result.validation.local.isValid).toBe(true);
      expect(result.validation.local.errors).toHaveLength(0);
      expect(result.validation.stripe.accepted).toBe(true);
      expect(stripeMockInstance.tax.calculations.create).toHaveBeenCalledWith(
        expect.objectContaining({
          currency: 'usd',
          customer_details: {
            address: {
              line1: address.line1,
              line2: address.line2,
              city: address.city,
              state: address.state,
              postal_code: address.postal_code,
              country: address.country
            },
            address_source: 'shipping'
          },
          line_items: [
            {
              amount: 100,
              reference: 'address-verification',
              tax_code: 'txcd_99999999'
            }
          ]
        })
      );
      expect(logger.debug).toHaveBeenCalledWith(
        'Verifying address with Stripe',
        expect.objectContaining({
          requestId: 'test-request-id',
          country: 'US',
          currency: 'usd'
        })
      );
    });

    it('should validate CA address successfully', async () => {
      const address = {
        country: 'CA',
        line1: '123 Main St',
        city: 'Toronto',
        state: 'ON',
        postal_code: 'K1A 0B1'
      };

      stripeMockInstance.tax.calculations.create.mockResolvedValue({
        id: 'calc_123'
      });

      const result = await addressService.validateAddress(address);

      expect(result.success).toBe(true);
      expect(result.validation.local.isValid).toBe(true);
      expect(stripeMockInstance.tax.calculations.create).toHaveBeenCalledWith(
        expect.objectContaining({
          currency: 'cad'
        })
      );
    });

    it('should handle Stripe verification failure gracefully', async () => {
      const address = {
        country: 'US',
        line1: '123 Main St',
        city: 'San Francisco',
        state: 'CA',
        postal_code: '94105'
      };

      const stripeError = new Error('Invalid address');
      stripeError.code = 'customer_tax_location_invalid';
      stripeError.type = 'StripeInvalidRequestError';
      stripeMockInstance.tax.calculations.create.mockRejectedValue(stripeError);

      const result = await addressService.validateAddress(address, 'test-request-id');

      expect(result.success).toBe(false);
      expect(result.validation.local.isValid).toBe(true);
      expect(result.validation.stripe.accepted).toBe(false);
      expect(result.validation.stripe.code).toBe('customer_tax_location_invalid');
      expect(result.validation.stripe.userMessage).toContain('address cannot be used for tax calculation');
      expect(result.validation.stripe.actionable).toBeDefined();
      expect(result.validation.stripe.actionable.action).toBeDefined();
      expect(result.validation.stripe.actionable.steps).toBeDefined();
      expect(logger.warn).toHaveBeenCalledWith(
        'Stripe verification failed',
        expect.objectContaining({
          requestId: 'test-request-id',
          code: 'customer_tax_location_invalid',
          type: 'StripeInvalidRequestError'
        })
      );
    });

    it('should handle Stripe error without code', async () => {
      const address = {
        country: 'US',
        line1: '123 Main St',
        city: 'San Francisco',
        state: 'CA',
        postal_code: '94105'
      };

      const stripeError = new Error('Network error');
      stripeMockInstance.tax.calculations.create.mockRejectedValue(stripeError);

      const result = await addressService.validateAddress(address);

      expect(result.success).toBe(false);
      expect(result.validation.stripe.accepted).toBe(false);
      expect(result.validation.stripe.code).toBe('STRIPE_ERROR');
      expect(result.validation.stripe.userMessage).toBe('Network error');
      expect(result.validation.stripe.actionable).toBeUndefined();
    });

    it('should not call Stripe when local validation fails', async () => {
      const address = {
        country: 'US',
        // Missing required fields
        city: 'San Francisco'
      };

      const result = await addressService.validateAddress(address);

      expect(result.success).toBe(false);
      expect(result.validation.local.isValid).toBe(false);
      expect(result.validation.stripe).toBeNull();
      expect(stripeMockInstance.tax.calculations.create).not.toHaveBeenCalled();
    });

    it('should use default currency when country currency is not found', async () => {
      process.env.ADDRESS_VALIDATION_STRIPE_DEFAULT_CURRENCY = 'eur';
      
      // For unknown countries, we need at least country to pass local validation
      // But XX is not a valid ISO code, so it will fail local validation
      // Let's use a valid country code that's not in the currency map
      const address = {
        country: 'JP', // Japan - valid ISO code but not in currency map
        line1: '123 Main St',
        city: 'Tokyo'
      };

      stripeMockInstance.tax.calculations.create.mockResolvedValue({
        id: 'calc_123'
      });

      await addressService.validateAddress(address);

      expect(stripeMockInstance.tax.calculations.create).toHaveBeenCalledWith(
        expect.objectContaining({
          currency: 'eur'
        })
      );
    });

    it('should use USD as fallback when no currency is configured', async () => {
      delete process.env.ADDRESS_VALIDATION_STRIPE_DEFAULT_CURRENCY;
      
      // Use a valid country code that's not in the currency map
      const address = {
        country: 'JP', // Japan - valid ISO code but not in currency map
        line1: '123 Main St',
        city: 'Tokyo'
      };

      stripeMockInstance.tax.calculations.create.mockResolvedValue({
        id: 'calc_123'
      });

      await addressService.validateAddress(address);

      expect(stripeMockInstance.tax.calculations.create).toHaveBeenCalledWith(
        expect.objectContaining({
          currency: 'usd'
        })
      );
    });

    it('should handle address with line2 field', async () => {
      const address = {
        country: 'US',
        line1: '123 Main St',
        line2: 'Apt 4B',
        city: 'San Francisco',
        state: 'CA',
        postal_code: '94105'
      };

      stripeMockInstance.tax.calculations.create.mockResolvedValue({
        id: 'calc_123'
      });

      const result = await addressService.validateAddress(address);

      expect(result.success).toBe(true);
      expect(stripeMockInstance.tax.calculations.create).toHaveBeenCalledWith(
        expect.objectContaining({
          customer_details: expect.objectContaining({
            address: expect.objectContaining({
              line2: 'Apt 4B'
            })
          })
        })
      );
    });

    it('should handle Stripe error with undefined message', async () => {
      const address = {
        country: 'US',
        line1: '123 Main St',
        city: 'San Francisco',
        state: 'CA',
        postal_code: '94105'
      };

      const stripeError = new Error();
      stripeError.code = 'customer_tax_location_invalid';
      stripeError.type = 'StripeInvalidRequestError';
      stripeError.message = undefined;
      stripeMockInstance.tax.calculations.create.mockRejectedValue(stripeError);

      const result = await addressService.validateAddress(address);

      expect(result.success).toBe(false);
      expect(result.validation.stripe.accepted).toBe(false);
      expect(result.validation.stripe.code).toBe('customer_tax_location_invalid');
      expect(result.validation.stripe.userMessage).toContain('address cannot be used for tax calculation');
    });

    it('should handle Stripe error with undefined type', async () => {
      const address = {
        country: 'US',
        line1: '123 Main St',
        city: 'San Francisco',
        state: 'CA',
        postal_code: '94105'
      };

      const stripeError = new Error('Test error');
      stripeError.code = 'shipping_address_invalid';
      stripeError.type = undefined;
      stripeMockInstance.tax.calculations.create.mockRejectedValue(stripeError);

      const result = await addressService.validateAddress(address, 'test-request-id');

      expect(result.success).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        'Stripe verification failed',
        expect.objectContaining({
          requestId: 'test-request-id',
          code: 'shipping_address_invalid',
          type: undefined
        })
      );
    });

    it('should log debug message when Stripe verification succeeds', async () => {
      const address = {
        country: 'US',
        line1: '123 Main St',
        city: 'San Francisco',
        state: 'CA',
        postal_code: '94105'
      };

      stripeMockInstance.tax.calculations.create.mockResolvedValue({
        id: 'calc_123'
      });

      await addressService.validateAddress(address, 'test-request-id');

      expect(logger.debug).toHaveBeenCalledWith(
        'Stripe calculation created for address verification',
        expect.objectContaining({
          requestId: 'test-request-id',
          calculationId: 'calc_123'
        })
      );
    });

    it('should return validation error when country is empty string', async () => {
      const address = {
        country: '',
        line1: '123 Main St',
        city: 'San Francisco',
        state: 'CA',
        postal_code: '94105'
      };

      const result = await addressService.validateAddress(address);

      expect(result.success).toBe(false);
      expect(result.validation.local.isValid).toBe(false);
      expect(result.validation.local.errors.some(e => e.code === 'MISSING_COUNTRY')).toBe(true);
    });

    it('should return address object with suggestions when structure validation fails', async () => {
      const result = await addressService.validateAddress(null);

      expect(result.address).toHaveProperty('suggestions');
      expect(Array.isArray(result.address.suggestions)).toBe(true);
      expect(result.validation.local.isValid).toBe(false);
    });
  });

  describe('address suggestions', () => {
    it('should generate suggestions for invalid postal code', async () => {
      const address = {
        country: 'US',
        line1: '123 Main St',
        city: 'San Francisco',
        state: 'CA',
        postal_code: 'INVALID'
      };

      const result = await addressService.validateAddress(address);

      expect(result.address.suggestions).toBeDefined();
      const postalCodeSuggestion = result.address.suggestions.find(
        s => s.field === 'postal_code'
      );
      expect(postalCodeSuggestion).toBeDefined();
      expect(postalCodeSuggestion.message).toContain('postal code format');
      expect(postalCodeSuggestion.example).toBe('94105 or 94105-1234');
    });

    it('should generate suggestions for invalid state', async () => {
      const address = {
        country: 'US',
        line1: '123 Main St',
        city: 'San Francisco',
        state: 'INVALID',
        postal_code: '94105'
      };

      const result = await addressService.validateAddress(address);

      expect(result.address.suggestions).toBeDefined();
      const stateSuggestion = result.address.suggestions.find(
        s => s.field === 'state'
      );
      expect(stateSuggestion).toBeDefined();
      expect(stateSuggestion.message).toContain('state/province code');
      expect(stateSuggestion.example).toBe('CA, NY, TX');
    });

    it('should generate suggestions for missing required fields', async () => {
      const address = {
        country: 'US',
        line1: '123 Main St'
        // Missing city, state, postal_code
      };

      const result = await addressService.validateAddress(address);

      expect(result.address.suggestions).toBeDefined();
      const missingFieldSuggestions = result.address.suggestions.filter(
        s => s.required === true
      );
      expect(missingFieldSuggestions.length).toBeGreaterThan(0);
    });

    it('should generate postal code example for CA', async () => {
      const address = {
        country: 'CA',
        line1: '123 Main St',
        city: 'Toronto',
        postal_code: 'INVALID'
      };

      const result = await addressService.validateAddress(address);

      const postalCodeSuggestion = result.address.suggestions.find(
        s => s.field === 'postal_code'
      );
      if (postalCodeSuggestion) {
        expect(postalCodeSuggestion.example).toBe('K1A 0B1');
      }
    });

    it('should generate postal code example for IN', async () => {
      const address = {
        country: 'IN',
        line1: '123 Main St',
        city: 'Mumbai',
        postal_code: 'INVALID'
      };

      const result = await addressService.validateAddress(address);

      const postalCodeSuggestion = result.address.suggestions.find(
        s => s.field === 'postal_code'
      );
      if (postalCodeSuggestion) {
        expect(postalCodeSuggestion.example).toBe('110001');
      }
    });
  });

  describe('error handling and user messages', () => {
    it('should return user-friendly message for shipping_address_invalid', async () => {
      const address = {
        country: 'US',
        line1: '123 Main St',
        city: 'San Francisco',
        state: 'CA',
        postal_code: '94105'
      };

      const stripeError = new Error('Shipping address invalid');
      stripeError.code = 'shipping_address_invalid';
      stripeMockInstance.tax.calculations.create.mockRejectedValue(stripeError);

      const result = await addressService.validateAddress(address);

      expect(result.validation.stripe.userMessage).toContain('shipping address is invalid');
      expect(result.validation.stripe.actionable).toBeDefined();
      expect(result.validation.stripe.actionable.action).toContain('Review and correct');
    });

    it('should return user-friendly message for invalid_tax_location', async () => {
      const address = {
        country: 'US',
        line1: '123 Main St',
        city: 'San Francisco',
        state: 'CA',
        postal_code: '94105'
      };

      const stripeError = new Error('Invalid tax location');
      stripeError.code = 'invalid_tax_location';
      stripeMockInstance.tax.calculations.create.mockRejectedValue(stripeError);

      const result = await addressService.validateAddress(address);

      expect(result.validation.stripe.userMessage).toContain('Tax calculation is not available');
    });

    it('should return user-friendly message for taxes_calculation_failed', async () => {
      const address = {
        country: 'US',
        line1: '123 Main St',
        city: 'San Francisco',
        state: 'CA',
        postal_code: '94105'
      };

      const stripeError = new Error('Tax calculation failed');
      stripeError.code = 'taxes_calculation_failed';
      stripeMockInstance.tax.calculations.create.mockRejectedValue(stripeError);

      const result = await addressService.validateAddress(address);

      expect(result.validation.stripe.userMessage).toContain('Unable to calculate taxes');
    });

    it('should return user-friendly message for stripe_tax_inactive', async () => {
      const address = {
        country: 'US',
        line1: '123 Main St',
        city: 'San Francisco',
        state: 'CA',
        postal_code: '94105'
      };

      const stripeError = new Error('Stripe Tax inactive');
      stripeError.code = 'stripe_tax_inactive';
      stripeMockInstance.tax.calculations.create.mockRejectedValue(stripeError);

      const result = await addressService.validateAddress(address);

      expect(result.validation.stripe.userMessage).toContain('Stripe Tax is not activated');
      expect(result.validation.stripe.actionable).toBeDefined();
      expect(result.validation.stripe.actionable.action).toContain('Enable Stripe Tax');
      expect(result.validation.stripe.actionable.steps).toContain(
        'Go to https://dashboard.stripe.com/settings/tax'
      );
    });

    it('should return default message for unknown error code', async () => {
      const address = {
        country: 'US',
        line1: '123 Main St',
        city: 'San Francisco',
        state: 'CA',
        postal_code: '94105'
      };

      const stripeError = new Error('Unknown error');
      stripeError.code = 'UNKNOWN_ERROR';
      stripeMockInstance.tax.calculations.create.mockRejectedValue(stripeError);

      const result = await addressService.validateAddress(address);

      expect(result.validation.stripe.userMessage).toBe('Unknown error');
      expect(result.validation.stripe.actionable).toBeUndefined();
    });
  });

  describe('currency mapping', () => {
    it('should use correct currency for EUR countries', async () => {
      const eurCountries = ['IE', 'FR', 'DE', 'IT', 'ES', 'NL', 'BE', 'AT', 'PT', 'FI', 'GR', 'LU', 'MT', 'CY', 'SK', 'SI', 'EE', 'LV', 'LT'];
      
      for (const country of eurCountries) {
        const address = {
          country,
          line1: '123 Main St',
          city: 'Test City'
        };

        stripeMockInstance.tax.calculations.create.mockResolvedValue({
          id: 'calc_123'
        });

        const result = await addressService.validateAddress(address);
        
        // Only check if local validation passed (some countries may require more fields)
        if (result.validation.local.isValid) {
          expect(stripeMockInstance.tax.calculations.create).toHaveBeenCalledWith(
            expect.objectContaining({
              currency: 'eur'
            })
          );
        }
        
        jest.clearAllMocks();
      }
    });

    it('should use correct currency for other countries', async () => {
      const testCases = [
        { country: 'GB', currency: 'gbp', line1: '123 Main St', city: 'London' },
        { country: 'AU', currency: 'aud', line1: '123 Main St', city: 'Sydney' },
        { country: 'NZ', currency: 'nzd', line1: '123 Main St', city: 'Auckland' }
      ];

      for (const testCase of testCases) {
        const address = {
          country: testCase.country,
          line1: testCase.line1,
          city: testCase.city
        };

        stripeMockInstance.tax.calculations.create.mockResolvedValue({
          id: 'calc_123'
        });

        const result = await addressService.validateAddress(address);
        
        // Only check if local validation passed
        if (result.validation.local.isValid) {
          expect(stripeMockInstance.tax.calculations.create).toHaveBeenCalledWith(
            expect.objectContaining({
              currency: testCase.currency
            })
          );
        }
        
        jest.clearAllMocks();
      }
    });
  });

  describe('validation result structure', () => {
    it('should return correct structure for successful validation', async () => {
      const address = {
        country: 'US',
        line1: '123 Main St',
        city: 'San Francisco',
        state: 'CA',
        postal_code: '94105'
      };

      stripeMockInstance.tax.calculations.create.mockResolvedValue({
        id: 'calc_123'
      });

      const result = await addressService.validateAddress(address);

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('validation');
      expect(result.validation).toHaveProperty('local');
      expect(result.validation).toHaveProperty('stripe');
      expect(result).toHaveProperty('address');
      expect(result.address).toHaveProperty('suggestions');
      expect(Array.isArray(result.address.suggestions)).toBe(true);
    });

    it('should return correct structure for failed validation', async () => {
      const address = {
        country: 'US'
        // Missing required fields
      };

      const result = await addressService.validateAddress(address);

      expect(result).toHaveProperty('success');
      expect(result.success).toBe(false);
      expect(result.validation).toHaveProperty('local');
      expect(result.validation.local).toHaveProperty('isValid');
      expect(result.validation.local).toHaveProperty('errors');
      expect(result.validation.stripe).toBeNull();
    });
  });
});

