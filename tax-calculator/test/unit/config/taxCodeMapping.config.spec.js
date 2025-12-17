import { expect, describe, it, jest, beforeEach, afterEach } from '@jest/globals';

// Mock logger before importing the module
jest.mock('../../../src/utils/logger.utils.js', () => ({
  logger: {
    debug: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn()
  }
}));

import taxCodeMappingConfig from '../../../src/config/taxCodeMapping.config.js';
import { logger } from '../../../src/utils/logger.utils.js';

describe('TaxCodeMappingConfig', () => {
  const originalEnv = process.env.TAX_CODE_CATEGORY_MAPPING_JSON;
  let originalMapping;
  let originalLastLoadedAt;

  beforeEach(() => {
    // Save original state
    originalMapping = taxCodeMappingConfig.mapping;
    originalLastLoadedAt = taxCodeMappingConfig.lastLoadedAt;
    
    // Reset state
    taxCodeMappingConfig.mapping = null;
    taxCodeMappingConfig.lastLoadedAt = null;
    
    // Clear environment variable
    delete process.env.TAX_CODE_CATEGORY_MAPPING_JSON;
    
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Restore original state
    taxCodeMappingConfig.mapping = originalMapping;
    taxCodeMappingConfig.lastLoadedAt = originalLastLoadedAt;
    process.env.TAX_CODE_CATEGORY_MAPPING_JSON = originalEnv;
  });

  describe('loadMapping', () => {
    it('should return cached mapping if available', () => {
      const cachedMapping = { categories: [{ ctCategory: { id: 'cat1' }, taxCode: 'txcd_123' }] };
      taxCodeMappingConfig.mapping = cachedMapping;

      const result = taxCodeMappingConfig.loadMapping();

      expect(result).toBe(cachedMapping);
      expect(logger.debug).toHaveBeenCalledWith('Using cached tax code mapping');
      expect(process.env.TAX_CODE_CATEGORY_MAPPING_JSON).toBeUndefined();
    });

    it('should return empty mapping when TAX_CODE_CATEGORY_MAPPING_JSON is not set', () => {
      const result = taxCodeMappingConfig.loadMapping();

      expect(result).toEqual({ categories: [] });
      expect(taxCodeMappingConfig.mapping).toEqual({ categories: [] });
      expect(taxCodeMappingConfig.lastLoadedAt).toBeDefined();
      expect(logger.warn).toHaveBeenCalledWith(
        'TAX_CODE_CATEGORY_MAPPING_JSON environment variable not set. Tax code lookup will rely on product custom fields only.'
      );
    });

    it('should load and parse valid mapping from environment variable', () => {
      const validMapping = {
        categories: [
          {
            ctCategory: { id: 'cat1', key: 'electronics' },
            taxCode: 'txcd_12345678'
          }
        ]
      };

      process.env.TAX_CODE_CATEGORY_MAPPING_JSON = JSON.stringify(validMapping);

      const result = taxCodeMappingConfig.loadMapping();

      expect(result).toEqual(validMapping);
      expect(taxCodeMappingConfig.mapping).toEqual(validMapping);
      expect(taxCodeMappingConfig.lastLoadedAt).toBeDefined();
      expect(logger.info).toHaveBeenCalledWith(
        'Tax code mapping loaded successfully',
        expect.objectContaining({
          categoryCount: 1,
          timestamp: expect.any(String)
        })
      );
    });

    it('should throw error when JSON is invalid', () => {
      process.env.TAX_CODE_CATEGORY_MAPPING_JSON = 'invalid json{';

      expect(() => {
        taxCodeMappingConfig.loadMapping();
      }).toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Invalid TAX_CODE_CATEGORY_MAPPING_JSON format')
      );
    });

    it('should throw error when mapping structure is invalid', () => {
      const invalidMapping = { invalid: 'structure' };
      process.env.TAX_CODE_CATEGORY_MAPPING_JSON = JSON.stringify(invalidMapping);

      expect(() => {
        taxCodeMappingConfig.loadMapping();
      }).toThrow('Mapping must contain a "categories" array');
    });
  });

  describe('validateMapping', () => {
    it('should throw error when mapping is not an object', () => {
      expect(() => {
        taxCodeMappingConfig.validateMapping(null);
      }).toThrow('Mapping must be a valid JSON object');

      expect(() => {
        taxCodeMappingConfig.validateMapping('string');
      }).toThrow('Mapping must be a valid JSON object');
    });

    it('should throw error when categories is missing', () => {
      expect(() => {
        taxCodeMappingConfig.validateMapping({});
      }).toThrow('Mapping must contain a "categories" array');
    });

    it('should throw error when categories is not an array', () => {
      expect(() => {
        taxCodeMappingConfig.validateMapping({ categories: 'not-array' });
      }).toThrow('Mapping must contain a "categories" array');
    });

    it('should throw error when category entry is missing ctCategory', () => {
      const invalidMapping = {
        categories: [
          { taxCode: 'txcd_123' }
        ]
      };

      expect(() => {
        taxCodeMappingConfig.validateMapping(invalidMapping);
      }).toThrow('Category entry at index 0 must contain a "ctCategory" object');
    });

    it('should throw error when ctCategory is not an object', () => {
      const invalidMapping = {
        categories: [
          { ctCategory: 'not-object', taxCode: 'txcd_123' }
        ]
      };

      expect(() => {
        taxCodeMappingConfig.validateMapping(invalidMapping);
      }).toThrow('Category entry at index 0 must contain a "ctCategory" object');
    });

    it('should throw error when ctCategory has neither id nor key', () => {
      const invalidMapping = {
        categories: [
          { ctCategory: {}, taxCode: 'txcd_123' }
        ]
      };

      expect(() => {
        taxCodeMappingConfig.validateMapping(invalidMapping);
      }).toThrow('Category entry at index 0: ctCategory must have either "id" or "key" property');
    });

    it('should throw error when taxCode is missing', () => {
      const invalidMapping = {
        categories: [
          { ctCategory: { id: 'cat1' } }
        ]
      };

      expect(() => {
        taxCodeMappingConfig.validateMapping(invalidMapping);
      }).toThrow('Category entry at index 0: Invalid tax code "undefined"');
    });

    it('should throw error when taxCode is not a string', () => {
      const invalidMapping = {
        categories: [
          { ctCategory: { id: 'cat1' }, taxCode: 123 }
        ]
      };

      expect(() => {
        taxCodeMappingConfig.validateMapping(invalidMapping);
      }).toThrow('Category entry at index 0: Invalid tax code "123"');
    });

    it('should throw error when taxCode does not start with txcd_', () => {
      const invalidMapping = {
        categories: [
          { ctCategory: { id: 'cat1' }, taxCode: 'invalid_code' }
        ]
      };

      expect(() => {
        taxCodeMappingConfig.validateMapping(invalidMapping);
      }).toThrow('Category entry at index 0: Invalid tax code "invalid_code"');
    });

    it('should validate multiple categories correctly', () => {
      const validMapping = {
        categories: [
          { ctCategory: { id: 'cat1' }, taxCode: 'txcd_11111111' },
          { ctCategory: { key: 'cat2' }, taxCode: 'txcd_22222222' },
          { ctCategory: { id: 'cat3', key: 'cat3' }, taxCode: 'txcd_33333333' }
        ]
      };

      expect(() => {
        taxCodeMappingConfig.validateMapping(validMapping);
      }).not.toThrow();

      expect(logger.debug).toHaveBeenCalledWith(
        'Tax code mapping validation passed',
        { categories: 3 }
      );
    });

    it('should throw error for second invalid category', () => {
      const invalidMapping = {
        categories: [
          { ctCategory: { id: 'cat1' }, taxCode: 'txcd_11111111' },
          { ctCategory: { id: 'cat2' }, taxCode: 'invalid' }
        ]
      };

      expect(() => {
        taxCodeMappingConfig.validateMapping(invalidMapping);
      }).toThrow('Category entry at index 1: Invalid tax code "invalid"');
    });
  });

  describe('getTaxCodeForCategory', () => {
    beforeEach(() => {
      const validMapping = {
        categories: [
          { ctCategory: { id: 'cat1' }, taxCode: 'txcd_11111111' },
          { ctCategory: { key: 'cat2' }, taxCode: 'txcd_22222222' },
          { ctCategory: { id: 'cat3', key: 'cat3' }, taxCode: 'txcd_33333333' }
        ]
      };
      process.env.TAX_CODE_CATEGORY_MAPPING_JSON = JSON.stringify(validMapping);
      taxCodeMappingConfig.loadMapping();
    });

    it('should return null when category is null', () => {
      const result = taxCodeMappingConfig.getTaxCodeForCategory(null);
      expect(result).toBeNull();
      expect(logger.debug).toHaveBeenCalledWith('Invalid category provided', { category: null });
    });

    it('should return null when category is not an object', () => {
      const result = taxCodeMappingConfig.getTaxCodeForCategory('string');
      expect(result).toBeNull();
      expect(logger.debug).toHaveBeenCalledWith('Invalid category provided', { category: 'string' });
    });

    it('should find tax code by category id', () => {
      const category = { id: 'cat1' };
      const result = taxCodeMappingConfig.getTaxCodeForCategory(category);

      expect(result).toBe('txcd_11111111');
      expect(logger.debug).toHaveBeenCalledWith(
        'Tax code found for category id "cat1"',
        { taxCode: 'txcd_11111111' }
      );
    });

    it('should find tax code by category key', () => {
      const category = { key: 'cat2' };
      const result = taxCodeMappingConfig.getTaxCodeForCategory(category);

      expect(result).toBe('txcd_22222222');
      expect(logger.debug).toHaveBeenCalledWith(
        'Tax code found for category key "cat2"',
        { taxCode: 'txcd_22222222' }
      );
    });

    it('should prioritize id over key when both exist', () => {
      const category = { id: 'cat1', key: 'cat2' };
      const result = taxCodeMappingConfig.getTaxCodeForCategory(category);

      expect(result).toBe('txcd_11111111');
      expect(logger.debug).toHaveBeenCalledWith(
        'Tax code found for category id "cat1"',
        { taxCode: 'txcd_11111111' }
      );
    });

    it('should return null when no matching category is found', () => {
      const category = { id: 'nonexistent', key: 'also-nonexistent' };
      const result = taxCodeMappingConfig.getTaxCodeForCategory(category);

      expect(result).toBeNull();
      expect(logger.debug).toHaveBeenCalledWith(
        'No tax code mapping found for category',
        {
          categoryId: 'nonexistent',
          categoryKey: 'also-nonexistent'
        }
      );
    });

    it('should return null when category has no id or key', () => {
      const category = { name: 'Category without id/key' };
      const result = taxCodeMappingConfig.getTaxCodeForCategory(category);

      expect(result).toBeNull();
      expect(logger.debug).toHaveBeenCalledWith(
        'No tax code mapping found for category',
        {
          categoryId: undefined,
          categoryKey: undefined
        }
      );
    });
  });
});

