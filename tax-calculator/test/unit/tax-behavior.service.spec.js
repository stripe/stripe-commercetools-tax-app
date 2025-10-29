import { expect, describe, it, jest, beforeEach } from '@jest/globals';
import { taxBehaviorService } from '../../src/services/tax-behavior.service.js';
import configUtils from '../../src/utils/config.util.js';
import { TAX_BEHAVIOR_INCLUSIVE, TAX_BEHAVIOR_EXCLUSIVE } from '../../src/constants/tax-behavior.constants.js';

// Mock the config utils
jest.mock('../../src/utils/config.util.js');

describe('TaxBehaviorService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('determineTaxBehaviorForCart', () => {
    it('should apply same behavior to all line items', async () => {
      const cartRequest = {
        country: 'DE',
        lineItems: [
          { id: 'line-item-1', productId: 'product-1' },
          { id: 'line-item-2', productId: 'product-2' }
        ]
      };

      // Mock country mapping to return inclusive
      configUtils.readConfiguration.mockReturnValue({
        countryTaxBehaviorMapping: '{"DE":"inclusive"}'
      });

      const result = await taxBehaviorService.determineTaxBehaviorForCart(cartRequest);

      expect(result).toEqual({
        'line-item-1': TAX_BEHAVIOR_INCLUSIVE,
        'line-item-2': TAX_BEHAVIOR_INCLUSIVE
      });
    });

    it('should handle empty line items array', async () => {
      const cartRequest = {
        country: 'DE',
        lineItems: []
      };

      configUtils.readConfiguration.mockReturnValue({
        countryTaxBehaviorMapping: '{"DE":"inclusive"}'
      });

      const result = await taxBehaviorService.determineTaxBehaviorForCart(cartRequest);

      expect(result).toEqual({});
    });
  });

  describe('determineCartTaxBehavior', () => {
    it('should return country mapping behavior when available', () => {
      const cartContext = { country: 'DE' };
      
      configUtils.readConfiguration.mockReturnValue({
        countryTaxBehaviorMapping: '{"DE":"inclusive"}'
      });

      const result = taxBehaviorService.determineCartTaxBehavior(cartContext);

      expect(result).toBe(TAX_BEHAVIOR_INCLUSIVE);
    });

    it('should return merchant default when no country mapping', () => {
      const cartContext = { country: 'US' };
      
      configUtils.readConfiguration.mockReturnValue({
        taxBehaviorDefault: TAX_BEHAVIOR_EXCLUSIVE
      });

      const result = taxBehaviorService.determineCartTaxBehavior(cartContext);

      expect(result).toBe(TAX_BEHAVIOR_EXCLUSIVE);
    });

    it('should return null when no behavior is determined', () => {
      const cartContext = { country: 'US' };
      
      configUtils.readConfiguration.mockReturnValue({});

      const result = taxBehaviorService.determineCartTaxBehavior(cartContext);

      expect(result).toBeNull();
    });

    it('should handle missing country in cart context', () => {
      const cartContext = {};
      
      configUtils.readConfiguration.mockReturnValue({
        taxBehaviorDefault: TAX_BEHAVIOR_INCLUSIVE
      });

      const result = taxBehaviorService.determineCartTaxBehavior(cartContext);

      expect(result).toBe(TAX_BEHAVIOR_INCLUSIVE);
    });
  });

  describe('isValidBehavior', () => {
    it('should return true for valid behaviors', () => {
      expect(taxBehaviorService.isValidBehavior(TAX_BEHAVIOR_INCLUSIVE)).toBe(true);
      expect(taxBehaviorService.isValidBehavior(TAX_BEHAVIOR_EXCLUSIVE)).toBe(true);
      expect(taxBehaviorService.isValidBehavior('INCLUSIVE')).toBe(true); // case insensitive
      expect(taxBehaviorService.isValidBehavior('EXCLUSIVE')).toBe(true); // case insensitive
    });

    it('should return false for invalid behaviors', () => {
      expect(taxBehaviorService.isValidBehavior('automatic')).toBe(false);
      expect(taxBehaviorService.isValidBehavior('invalid')).toBe(false);
      expect(taxBehaviorService.isValidBehavior(null)).toBe(false);
      expect(taxBehaviorService.isValidBehavior(undefined)).toBe(false);
    });
  });

  describe('getCountryBasedBehavior', () => {
    it('should return behavior from country mapping', () => {
      const cartContext = { country: 'DE' };
      
      configUtils.readConfiguration.mockReturnValue({
        countryTaxBehaviorMapping: '{"DE":"inclusive","US":"exclusive"}'
      });

      const result = taxBehaviorService.getCountryBasedBehavior(cartContext);

      expect(result).toBe(TAX_BEHAVIOR_INCLUSIVE);
    });

    it('should return null for unmapped country', () => {
      const cartContext = { country: 'CA' };
      
      configUtils.readConfiguration.mockReturnValue({
        countryTaxBehaviorMapping: '{"DE":"inclusive","US":"exclusive"}'
      });

      const result = taxBehaviorService.getCountryBasedBehavior(cartContext);

      expect(result).toBeNull();
    });

    it('should handle invalid JSON in country mapping', () => {
      const cartContext = { country: 'DE' };
      
      configUtils.readConfiguration.mockReturnValue({
        countryTaxBehaviorMapping: 'invalid-json'
      });

      const result = taxBehaviorService.getCountryBasedBehavior(cartContext);

      expect(result).toBeNull();
    });
  });

  describe('getMerchantDefaultBehavior', () => {
    it('should return configured default behavior', () => {
      configUtils.readConfiguration.mockReturnValue({
        taxBehaviorDefault: TAX_BEHAVIOR_INCLUSIVE
      });

      const result = taxBehaviorService.getMerchantDefaultBehavior();

      expect(result).toBe(TAX_BEHAVIOR_INCLUSIVE);
    });

    it('should return null when no default is configured', () => {
      configUtils.readConfiguration.mockReturnValue({});

      const result = taxBehaviorService.getMerchantDefaultBehavior();

      expect(result).toBeNull();
    });

    it('should handle configuration errors gracefully', () => {
      configUtils.readConfiguration.mockImplementation(() => {
        throw new Error('Config error');
      });

      const result = taxBehaviorService.getMerchantDefaultBehavior();

      expect(result).toBeNull();
    });
  });

  describe('getDecisionReason', () => {
    it('should return country_mapping when country behavior is available', () => {
      const cartContext = { country: 'DE' };
      
      configUtils.readConfiguration.mockReturnValue({
        countryTaxBehaviorMapping: '{"DE":"inclusive"}'
      });

      const result = taxBehaviorService.getDecisionReason(cartContext, TAX_BEHAVIOR_INCLUSIVE);

      expect(result).toBe('country_mapping');
    });

    it('should return merchant_default when no country behavior', () => {
      const cartContext = { country: 'US' };
      
      configUtils.readConfiguration.mockReturnValue({
        taxBehaviorDefault: TAX_BEHAVIOR_EXCLUSIVE
      });

      const result = taxBehaviorService.getDecisionReason(cartContext, TAX_BEHAVIOR_EXCLUSIVE);

      expect(result).toBe('merchant_default');
    });
  });
});
