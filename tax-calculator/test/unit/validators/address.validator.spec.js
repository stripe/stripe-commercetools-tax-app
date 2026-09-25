import { expect, describe, it } from '@jest/globals';
import {
  validateAddress,
  validateCartAddress,
  isValidForTaxCalculation
} from '../../../src/validators/address.validator.js';

describe('AddressValidator', () => {
  describe('validateAddress', () => {
    it('should return error when address is null', () => {
      const errors = validateAddress(null);
      expect(errors).toEqual([
        { code: 'INVALID_ADDRESS', message: 'Address must be a valid object' }
      ]);
    });

    it('should return error when address is not an object', () => {
      const errors = validateAddress('not-an-object');
      expect(errors).toEqual([
        { code: 'INVALID_ADDRESS', message: 'Address must be a valid object' }
      ]);
    });

    it('should return error when country is missing', () => {
      const errors = validateAddress({});
      expect(errors).toEqual([
        { code: 'MISSING_COUNTRY', message: 'Country is required for tax calculation' }
      ]);
    });

    it('should return error when country is invalid ISO code', () => {
      const errors = validateAddress({ country: 'INVALID' });
      expect(errors).toEqual([
        { code: 'INVALID_COUNTRY', message: 'Country must be a valid ISO 3166-1 alpha-2 code' }
      ]);
    });

    describe('US address validation', () => {
      it('should validate valid US address', () => {
        const address = {
          country: 'US',
          line1: '123 Main St',
          city: 'New York',
          state: 'NY',
          postal_code: '10001'
        };
        const errors = validateAddress(address);
        expect(errors).toEqual([]);
      });

      it('should return error when required US field is missing', () => {
        const address = {
          country: 'US',
          line1: '123 Main St',
          city: 'New York',
          state: 'NY'
          // postal_code missing
        };
        const errors = validateAddress(address);
        expect(errors.some(e => e.code === 'MISSING_POSTAL_CODE')).toBe(true);
      });

      it('should return error when US postal code format is invalid', () => {
        const address = {
          country: 'US',
          line1: '123 Main St',
          city: 'New York',
          state: 'NY',
          postal_code: 'INVALID'
        };
        const errors = validateAddress(address);
        expect(errors.some(e => e.code === 'INVALID_POSTAL_CODE')).toBe(true);
      });

      it('should accept US postal code with extension', () => {
        const address = {
          country: 'US',
          line1: '123 Main St',
          city: 'New York',
          state: 'NY',
          postal_code: '10001-1234'
        };
        const errors = validateAddress(address);
        expect(errors).toEqual([]);
      });

      it('should return error when US state code is invalid', () => {
        const address = {
          country: 'US',
          line1: '123 Main St',
          city: 'New York',
          state: 'XX',
          postal_code: '10001'
        };
        const errors = validateAddress(address);
        expect(errors.some(e => e.code === 'INVALID_STATE')).toBe(true);
      });

      it('should accept valid US state codes', () => {
        const validStates = ['CA', 'NY', 'TX', 'FL'];
        validStates.forEach(state => {
          const address = {
            country: 'US',
            line1: '123 Main St',
            city: 'New York',
            state,
            postal_code: '10001'
          };
          const errors = validateAddress(address);
          expect(errors.some(e => e.code === 'INVALID_STATE')).toBe(false);
        });
      });
    });

    describe('CA address validation', () => {
      it('should validate valid CA address with postal code', () => {
        const address = {
          country: 'CA',
          postal_code: 'K1A 0B1'
        };
        const errors = validateAddress(address);
        expect(errors).toEqual([]);
      });

      it('should validate CA address without postal code', () => {
        const address = {
          country: 'CA'
        };
        const errors = validateAddress(address);
        expect(errors).toEqual([]);
      });

      it('should return error when CA postal code format is invalid', () => {
        const address = {
          country: 'CA',
          postal_code: 'INVALID'
        };
        const errors = validateAddress(address);
        expect(errors.some(e => e.code === 'INVALID_POSTAL_CODE')).toBe(true);
      });

      it('should accept CA postal code without space', () => {
        const address = {
          country: 'CA',
          postal_code: 'K1A0B1'
        };
        const errors = validateAddress(address);
        expect(errors).toEqual([]);
      });

      it('should return error when CA state code is invalid', () => {
        const address = {
          country: 'CA',
          state: 'XX'
        };
        const errors = validateAddress(address);
        expect(errors.some(e => e.code === 'INVALID_STATE')).toBe(true);
      });

      it('should accept valid CA province codes', () => {
        const validProvinces = ['ON', 'QC', 'BC', 'AB'];
        validProvinces.forEach(state => {
          const address = {
            country: 'CA',
            state
          };
          const errors = validateAddress(address);
          expect(errors.some(e => e.code === 'INVALID_STATE')).toBe(false);
        });
      });
    });

    describe('IN address validation', () => {
      it('should validate IN address with postal code', () => {
        const address = {
          country: 'IN',
          postal_code: '110001'
        };
        const errors = validateAddress(address);
        expect(errors).toEqual([]);
      });

      it('should validate IN address with state', () => {
        const address = {
          country: 'IN',
          state: 'DL'
        };
        const errors = validateAddress(address);
        expect(errors).toEqual([]);
      });

      it('should return error when IN address has neither postal_code nor state', () => {
        const address = {
          country: 'IN'
        };
        const errors = validateAddress(address);
        expect(errors.some(e => e.code === 'MISSING_REQUIRED_FIELD')).toBe(true);
      });

      it('should return error when IN postal code format is invalid', () => {
        const address = {
          country: 'IN',
          postal_code: 'INVALID'
        };
        const errors = validateAddress(address);
        expect(errors.some(e => e.code === 'INVALID_POSTAL_CODE')).toBe(true);
      });
    });

    describe('Default country validation', () => {
      it('should validate address with only country', () => {
        const address = {
          country: 'GB'
        };
        const errors = validateAddress(address);
        expect(errors).toEqual([]);
      });

      it('should accept optional state and postal_code for default countries', () => {
        const address = {
          country: 'GB',
          state: 'England',
          postal_code: 'SW1A 1AA'
        };
        const errors = validateAddress(address);
        expect(errors).toEqual([]);
      });
    });

    describe('Field length validation', () => {
      it('should return error when line1 is too short', () => {
        const address = {
          country: 'US',
          line1: '',
          city: 'New York',
          state: 'NY',
          postal_code: '10001'
        };
        const errors = validateAddress(address);
        expect(errors.some(e => e.code === 'MISSING_LINE1')).toBe(true);
      });

      it('should return error when line1 is too long', () => {
        const address = {
          country: 'US',
          line1: 'A'.repeat(201),
          city: 'New York',
          state: 'NY',
          postal_code: '10001'
        };
        const errors = validateAddress(address);
        expect(errors.some(e => e.code === 'INVALID_LINE1')).toBe(true);
      });

      it('should return error when city is too short', () => {
        const address = {
          country: 'US',
          line1: '123 Main St',
          city: '',
          state: 'NY',
          postal_code: '10001'
        };
        const errors = validateAddress(address);
        expect(errors.some(e => e.code === 'MISSING_CITY')).toBe(true);
      });

      it('should return error when city is too long', () => {
        const address = {
          country: 'US',
          line1: '123 Main St',
          city: 'A'.repeat(101),
          state: 'NY',
          postal_code: '10001'
        };
        const errors = validateAddress(address);
        expect(errors.some(e => e.code === 'INVALID_CITY')).toBe(true);
      });

      it('should accept valid line1 length', () => {
        const address = {
          country: 'US',
          line1: 'A'.repeat(200),
          city: 'New York',
          state: 'NY',
          postal_code: '10001'
        };
        const errors = validateAddress(address);
        expect(errors.some(e => e.code === 'INVALID_LINE1')).toBe(false);
      });

      it('should accept valid city length', () => {
        const address = {
          country: 'US',
          line1: '123 Main St',
          city: 'A'.repeat(100),
          state: 'NY',
          postal_code: '10001'
        };
        const errors = validateAddress(address);
        expect(errors.some(e => e.code === 'INVALID_CITY')).toBe(false);
      });
    });

    it('should handle empty string values as missing', () => {
      const address = {
        country: 'US',
        line1: '   ',
        city: 'New York',
        state: 'NY',
        postal_code: '10001'
      };
      const errors = validateAddress(address);
      expect(errors.some(e => e.code === 'MISSING_LINE1')).toBe(true);
    });
  });

  describe('validateCartAddress', () => {
    it('should return error when cartRequest is null', () => {
      const errors = validateCartAddress(null);
      expect(errors).toEqual([
        { code: 'MISSING_CART', message: 'Cart request is required' }
      ]);
    });

    it('should validate Single shipping mode address', () => {
      const cartRequest = {
        country: 'US',
        shippingMode: 'Single',
        shippingAddress: {
          country: 'US',
          streetName: '123 Main St',
          city: 'New York',
          state: 'NY',
          postalCode: '10001'
        }
      };
      const errors = validateCartAddress(cartRequest);
      expect(errors).toEqual([]);
    });

    it('should validate Multiple shipping mode address', () => {
      const cartRequest = {
        country: 'US',
        shippingMode: 'Multiple',
        shipping: [
          {
            shippingAddress: {
              country: 'US',
              streetName: '123 Main St',
              city: 'New York',
              state: 'NY',
              postalCode: '10001'
            }
          }
        ]
      };
      const errors = validateCartAddress(cartRequest);
      expect(errors).toEqual([]);
    });

    it('reports a missing country when the cart has no delivery address, even if cart.country is set', () => {
      // Before SB3-218 this asserted the opposite: cart.country was accepted as the address
      // country, so a cart with no delivery address at all validated as having one. The validator
      // now judges the delivery address on its own, and a cart without one has no destination to
      // validate — cart.country selects prices and cannot stand in for it.
      const cartRequest = {
        country: 'US',
        shippingMode: 'Single'
      };
      const errors = validateCartAddress(cartRequest);
      expect(errors.some(e => e.code === 'MISSING_COUNTRY')).toBe(true);
    });

    it('should handle missing shipping in Multiple mode', () => {
      const cartRequest = {
        country: 'US',
        shippingMode: 'Multiple',
        shipping: []
      };
      const errors = validateCartAddress(cartRequest);
      // Should not throw, but may have validation errors for missing address fields
      expect(Array.isArray(errors)).toBe(true);
    });

    it('should map cart address fields correctly', () => {
      const cartRequest = {
        country: 'US',
        shippingMode: 'Single',
        shippingAddress: {
          country: 'US',
          streetName: '123 Main St',
          city: 'New York',
          state: 'NY',
          postalCode: '10001'
        }
      };
      const errors = validateCartAddress(cartRequest);
      // Should validate successfully
      expect(errors).toEqual([]);
    });
  });

  describe('isValidForTaxCalculation', () => {
    it('should return true for valid address', () => {
      const address = {
        country: 'US',
        line1: '123 Main St',
        city: 'New York',
        state: 'NY',
        postal_code: '10001'
      };
      expect(isValidForTaxCalculation(address)).toBe(true);
    });

    it('should return false for invalid address', () => {
      const address = {
        country: 'US'
        // Missing required fields
      };
      expect(isValidForTaxCalculation(address)).toBe(false);
    });

    it('should return false for null address', () => {
      expect(isValidForTaxCalculation(null)).toBe(false);
    });

    it('should return false for address with validation errors', () => {
      const address = {
        country: 'INVALID'
      };
      expect(isValidForTaxCalculation(address)).toBe(false);
    });
  });
});

