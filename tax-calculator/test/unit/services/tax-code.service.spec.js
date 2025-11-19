import { expect, describe, it, jest, beforeEach, afterEach } from '@jest/globals';
import taxCodeService from '../../../src/services/tax-code.service.js';
import TaxCodeNotFoundError from '../../../src/errors/taxCodeNotFound.error.js';
import { TAX_CODE_CUSTOM_TYPE_NAME } from '../../../src/connectors/customTypes.js';

// Mock dependencies
jest.mock('../../../src/utils/logger.utils.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

jest.mock('../../../src/clients/create.client.js', () => ({
  createApiRoot: jest.fn()
}));

jest.mock('../../../src/config/taxCodeMapping.config.js', () => ({
  default: {
    getTaxCodeForCategory: jest.fn().mockReturnValue(null)
  }
}));

import { logger } from '../../../src/utils/logger.utils.js';
import { createApiRoot } from '../../../src/clients/create.client.js';
import taxCodeMappingConfig from '../../../src/config/taxCodeMapping.config.js';

describe('TaxCodeService', () => {
  let mockApiRoot;
  let mockShippingMethods;
  let originalGetCustomTypeCategoryTaxCode;

  beforeEach(() => {
    originalGetCustomTypeCategoryTaxCode = taxCodeService.getCustomTypeCategoryTaxCode;
    
    mockShippingMethods = {
      withId: jest.fn().mockReturnThis(),
      get: jest.fn().mockReturnThis(),
      execute: jest.fn()
    };
    
    mockApiRoot = {
      shippingMethods: jest.fn().mockReturnValue(mockShippingMethods)
    };
    
    createApiRoot.mockReturnValue(mockApiRoot);
    
    if (taxCodeMappingConfig && typeof taxCodeMappingConfig.getTaxCodeForCategory === 'function') {
      taxCodeMappingConfig.getTaxCodeForCategory.mockReset();
      taxCodeMappingConfig.getTaxCodeForCategory.mockReturnValue(null);
    } else {
      taxCodeMappingConfig.getTaxCodeForCategory = jest.fn().mockReturnValue(null);
    }
    
    // Clear shipping method cache before each test
    taxCodeService.clearShippingMethodCache();
    
    jest.clearAllMocks();
    taxCodeMappingConfig.getTaxCodeForCategory.mockReturnValue(null);
  });

  afterEach(() => {
    if (originalGetCustomTypeCategoryTaxCode) {
      taxCodeService.getCustomTypeCategoryTaxCode = originalGetCustomTypeCategoryTaxCode;
    }
  });

  describe('getTaxCodeForProduct', () => {
    it('should return tax code from category custom type (direct categories only)', () => {
      const cartLineItem = {
        id: 'line-item-1',
        productId: 'product-1',
        name: 'Test Product',
        categories: []
      };

      // Test direct category tax code
      const productCategories1 = [
        {
          id: 'category-1',
          custom: {
            fields: {
              [TAX_CODE_CUSTOM_TYPE_NAME]: 'txcd_11111111'
            }
          }
        }
      ];

      const result1 = taxCodeService.getTaxCodeForProduct(cartLineItem, productCategories1);
      expect(result1).toBe('txcd_11111111');
      expect(logger.info).toHaveBeenCalledWith(
        'Tax code assigned',
        expect.objectContaining({
          productId: 'product-1',
          taxCode: 'txcd_11111111',
          source: 'custom_type_category'
        })
      );

      // Test category without tax code (parent hierarchy is NOT searched)
      const productCategories2 = [
        {
          id: 'category-1',
          custom: { fields: {} },
          parent: {
            obj: {
              id: 'parent-category-1',
              custom: {
                fields: {
                  [TAX_CODE_CUSTOM_TYPE_NAME]: 'txcd_22222222'
                }
              }
            }
          }
        }
      ];

      // Should throw error because no tax code found in direct categories
      expect(() => {
        taxCodeService.getTaxCodeForProduct(cartLineItem, productCategories2);
      }).toThrow(TaxCodeNotFoundError);

      // Test multiple categories - finds first with tax code
      const productCategories3 = [
        {
          id: 'category-1',
          custom: { fields: {} }
        },
        {
          id: 'category-2',
          custom: {
            fields: {
              [TAX_CODE_CUSTOM_TYPE_NAME]: 'txcd_33333333'
            }
          }
        }
      ];

      const result3 = taxCodeService.getTaxCodeForProduct(cartLineItem, productCategories3);
      expect(result3).toBe('txcd_33333333');
    });

    it('should throw TaxCodeNotFoundError when no tax code found or invalid input', () => {
      const cartLineItem = {
        id: 'line-item-1',
        productId: 'product-1',
        name: 'Test Product',
        categories: [{ id: 'category-1', name: 'Electronics' }]
      };

      const productCategories = [
        { id: 'category-1', name: 'Electronics' }
      ];

      expect(() => {
        taxCodeService.getTaxCodeForProduct(cartLineItem, productCategories);
      }).toThrow(TaxCodeNotFoundError);

      expect(() => {
        taxCodeService.getTaxCodeForProduct(null, []);
      }).toThrow('Cart line item is required');

      expect(() => {
        taxCodeService.getTaxCodeForProduct(cartLineItem, []);
      }).toThrow(TaxCodeNotFoundError);

      expect(() => {
        taxCodeService.getTaxCodeForProduct(cartLineItem, null);
      }).toThrow(TaxCodeNotFoundError);
    });

    it('should prevent infinite loops in hierarchy traversal and handle unexpected errors', () => {
      const cartLineItem = {
        id: 'line-item-1',
        productId: 'product-1',
        name: 'Test Product',
        categories: []
      };

      // Test circular reference
      const category = {
        id: 'category-1',
        custom: { fields: {} }
      };
      category.parent = { obj: category };

      expect(() => {
        taxCodeService.getTaxCodeForProduct(cartLineItem, [category]);
      }).toThrow(TaxCodeNotFoundError);

      // Test unexpected error
      taxCodeService.getCustomTypeCategoryTaxCode = jest.fn(() => {
        throw new Error('Unexpected error');
      });

      expect(() => {
        taxCodeService.getTaxCodeForProduct(cartLineItem, []);
      }).toThrow('Unexpected error');

      expect(logger.error).toHaveBeenCalledWith(
        'Unexpected error in tax code determination',
        expect.objectContaining({
          error: 'Unexpected error',
          productId: 'product-1'
        })
      );
    });
  });

  describe('getCustomTypeCategoryTaxCode', () => {
    it('should find tax code in direct categories only (no parent hierarchy search), or return null', () => {
      // Test empty array
      expect(taxCodeService.getCustomTypeCategoryTaxCode([])).toBeNull();

      // Test direct tax code
      const categories1 = [
        { id: 'category-1', custom: { fields: {} } },
        {
          id: 'category-2',
          custom: {
            fields: {
              [TAX_CODE_CUSTOM_TYPE_NAME]: 'txcd_44444444'
            }
          }
        }
      ];
      expect(taxCodeService.getCustomTypeCategoryTaxCode(categories1)).toBe('txcd_44444444');

      // Test category without tax code (parent hierarchy is NOT searched)
      const categories2 = [
        {
          id: 'category-1',
          custom: { fields: {} },
          parent: {
            obj: {
              id: 'parent-1',
              custom: {
                fields: {
                  [TAX_CODE_CUSTOM_TYPE_NAME]: 'txcd_55555555'
                }
              }
            }
          }
        }
      ];
      // Should return null because parent hierarchy is not searched
      expect(taxCodeService.getCustomTypeCategoryTaxCode(categories2)).toBeNull();

      // Test no tax code
      const categories3 = [
        { id: 'category-1', custom: { fields: {} } },
        { id: 'category-2' }
      ];
      expect(taxCodeService.getCustomTypeCategoryTaxCode(categories3)).toBeNull();
    });
  });

  describe('findFirstTaxCodeInHierarchy', () => {
    it('should find tax code in current or parent category, respect max depth, and prevent duplicates (NOTE: This method exists but is not currently used in the main flow)', () => {
      // Test current category
      const category1 = {
        id: 'category-1',
        custom: {
          fields: {
            [TAX_CODE_CUSTOM_TYPE_NAME]: 'txcd_55555555'
          }
        }
      };
      expect(taxCodeService.findFirstTaxCodeInHierarchy(category1, new Set())).toBe('txcd_55555555');

      // Test parent category
      const category2 = {
        id: 'category-1',
        custom: { fields: {} },
        parent: {
          obj: {
            id: 'parent-1',
            custom: {
              fields: {
                [TAX_CODE_CUSTOM_TYPE_NAME]: 'txcd_66666666'
              }
            }
          }
        }
      };
      expect(taxCodeService.findFirstTaxCodeInHierarchy(category2, new Set())).toBe('txcd_66666666');

      // Test null category
      expect(taxCodeService.findFirstTaxCodeInHierarchy(null, new Set())).toBeNull();

      // Test already processed
      const processedCategories = new Set(['category-1']);
      expect(taxCodeService.findFirstTaxCodeInHierarchy(category1, processedCategories)).toBeNull();

      // Test max depth
      let category = {
        id: 'category-1',
        custom: { fields: {} },
        parent: { obj: null }
      };
      let current = category;
      for (let i = 0; i < 15; i++) {
        current.parent = {
          obj: {
            id: `category-${i + 2}`,
            custom: { fields: {} },
            parent: { obj: null }
          }
        };
        current = current.parent.obj;
      }
      expect(taxCodeService.findFirstTaxCodeInHierarchy(category, new Set())).toBeNull();
    });
  });

  describe('getCustomFieldTaxCode', () => {
    it('should return tax code from line item or variant custom field, prioritizing line item', () => {
      // Test line item custom field
      const lineItem1 = {
        id: 'line-item-1',
        productId: 'product-1',
        custom: {
          fields: {
            [TAX_CODE_CUSTOM_TYPE_NAME]: 'txcd_line_item'
          }
        }
      };
      expect(taxCodeService.getCustomFieldTaxCode(lineItem1)).toBe('txcd_line_item');

      // Test variant custom field
      const lineItem2 = {
        id: 'line-item-1',
        productId: 'product-1',
        variant: {
          id: 'variant-1',
          custom: {
            fields: {
              [TAX_CODE_CUSTOM_TYPE_NAME]: 'txcd_variant'
            }
          }
        }
      };
      expect(taxCodeService.getCustomFieldTaxCode(lineItem2)).toBe('txcd_variant');

      // Test priority - line item over variant
      const lineItem3 = {
        id: 'line-item-1',
        productId: 'product-1',
        custom: {
          fields: {
            [TAX_CODE_CUSTOM_TYPE_NAME]: 'txcd_line_item'
          }
        },
        variant: {
          id: 'variant-1',
          custom: {
            fields: {
              [TAX_CODE_CUSTOM_TYPE_NAME]: 'txcd_variant'
            }
          }
        }
      };
      expect(taxCodeService.getCustomFieldTaxCode(lineItem3)).toBe('txcd_line_item');

      // Test no custom fields
      const lineItem4 = {
        id: 'line-item-1',
        productId: 'product-1'
      };
      expect(taxCodeService.getCustomFieldTaxCode(lineItem4)).toBeNull();

      // Test custom fields but no tax code
      const lineItem5 = {
        id: 'line-item-1',
        productId: 'product-1',
        custom: {
          fields: {
            otherField: 'value'
          }
        }
      };
      expect(taxCodeService.getCustomFieldTaxCode(lineItem5)).toBeNull();
    });
  });

  describe('getCategoryTaxCode', () => {
    it('should return tax code from mapping config or null when not found', () => {
      const cartLineItem = {
        id: 'line-item-1',
        productId: 'product-1'
      };

      // Test empty categories
      expect(taxCodeService.getCategoryTaxCode(cartLineItem, [])).toBeNull();

      // Test with mapping
      const categories1 = [
        { id: 'category-1', key: 'electronics' }
      ];
      taxCodeMappingConfig.getTaxCodeForCategory.mockReturnValue('txcd_mapped');
      expect(taxCodeService.getCategoryTaxCode(cartLineItem, categories1)).toBe('txcd_mapped');
      expect(taxCodeMappingConfig.getTaxCodeForCategory).toHaveBeenCalledWith(categories1[0]);

      // Test skipping categories without id/key
      const categories2 = [
        { name: 'Category without id/key' },
        { id: 'category-2', key: 'electronics' }
      ];
      taxCodeMappingConfig.getTaxCodeForCategory.mockReturnValue('txcd_mapped');
      expect(taxCodeService.getCategoryTaxCode(cartLineItem, categories2)).toBe('txcd_mapped');
      expect(taxCodeMappingConfig.getTaxCodeForCategory).toHaveBeenCalledWith(categories2[1]);

      // Test trying each category until match
      const categories3 = [
        { id: 'category-1', key: 'cat1' },
        { id: 'category-2', key: 'cat2' }
      ];
      taxCodeMappingConfig.getTaxCodeForCategory
        .mockReturnValueOnce(null)
        .mockReturnValueOnce('txcd_second');
      expect(taxCodeService.getCategoryTaxCode(cartLineItem, categories3)).toBe('txcd_second');

      // Test no match
      taxCodeMappingConfig.getTaxCodeForCategory.mockReturnValue(null);
      expect(taxCodeService.getCategoryTaxCode(cartLineItem, categories3)).toBeNull();
    });
  });

  describe('getParentCategoryTaxCode', () => {
    it('should traverse parent chain to find tax code or return null', () => {
      // Test empty categories
      expect(taxCodeService.getParentCategoryTaxCode([])).toBeNull();

      // Test with parent tax code
      const categories1 = [
        {
          id: 'category-1',
          parent: {
            obj: {
              id: 'parent-1',
              key: 'parent-key'
            }
          }
        }
      ];
      taxCodeMappingConfig.getTaxCodeForCategory.mockReturnValue('txcd_parent');
      expect(taxCodeService.getParentCategoryTaxCode(categories1)).toBe('txcd_parent');

      // Test no parent tax code
      taxCodeMappingConfig.getTaxCodeForCategory.mockReturnValue(null);
      expect(taxCodeService.getParentCategoryTaxCode(categories1)).toBeNull();

      // Test no parent
      const categories2 = [{ id: 'category-1' }];
      expect(taxCodeService.getParentCategoryTaxCode(categories2)).toBeNull();
    });
  });

  describe('traverseParentChain', () => {
    it('should recursively traverse parent chain to find tax code, respect max depth, and handle edge cases', () => {
      // Test immediate parent
      const category1 = {
        id: 'category-1',
        parent: {
          obj: {
            id: 'parent-1',
            key: 'parent-key'
          }
        }
      };
      taxCodeMappingConfig.getTaxCodeForCategory.mockReturnValue('txcd_parent');
      expect(taxCodeService.traverseParentChain(category1)).toBe('txcd_parent');

      // Test grandparent
      const category2 = {
        id: 'category-1',
        parent: {
          obj: {
            id: 'parent-1',
            parent: {
              obj: {
                id: 'grandparent-1',
                key: 'grandparent-key'
              }
            }
          }
        }
      };
      taxCodeMappingConfig.getTaxCodeForCategory
        .mockReturnValueOnce(null)
        .mockReturnValueOnce('txcd_grandparent');
      expect(taxCodeService.traverseParentChain(category2)).toBe('txcd_grandparent');

      // Test null category
      expect(taxCodeService.traverseParentChain(null)).toBeNull();

      // Test max depth
      let category = {
        id: 'category-1',
        parent: { obj: null }
      };
      let current = category;
      for (let i = 0; i < 15; i++) {
        current.parent = {
          obj: {
            id: `category-${i + 2}`,
            parent: { obj: null }
          }
        };
        current = current.parent.obj;
      }
      taxCodeMappingConfig.getTaxCodeForCategory.mockReturnValue(null);
      expect(taxCodeService.traverseParentChain(category)).toBeNull();

      // Test no parent
      const category3 = { id: 'category-1' };
      expect(taxCodeService.traverseParentChain(category3)).toBeNull();
    });
  });

  describe('getShippingTaxCodeFromShippingInfo', () => {
    it('should return tax code from shipping method custom field or null when not found', async () => {
      // Test with tax code
      const shippingInfo1 = {
        shippingMethod: {
          id: 'shipping-method-1'
        }
      };

      const mockShippingMethod1 = {
        body: {
          id: 'shipping-method-1',
          custom: {
            fields: {
              [TAX_CODE_CUSTOM_TYPE_NAME]: 'txcd_shipping_01'
            }
          }
        }
      };
      mockShippingMethods.execute.mockResolvedValue(mockShippingMethod1);
      expect(await taxCodeService.getShippingTaxCodeFromShippingInfo(shippingInfo1)).toBe('txcd_shipping_01');

      // Clear cache and test no tax code (use different ID to avoid cache)
      taxCodeService.clearShippingMethodCache();
      const shippingInfo2 = {
        shippingMethod: {
          id: 'shipping-method-2'
        }
      };

      const mockShippingMethod2 = {
        body: {
          id: 'shipping-method-2',
          custom: {
            fields: {}
          }
        }
      };
      mockShippingMethods.execute.mockResolvedValue(mockShippingMethod2);
      expect(await taxCodeService.getShippingTaxCodeFromShippingInfo(shippingInfo2)).toBeNull();

      // Clear cache and test no custom fields (use different ID to avoid cache)
      taxCodeService.clearShippingMethodCache();
      const shippingInfo3 = {
        shippingMethod: {
          id: 'shipping-method-3'
        }
      };

      const mockShippingMethod3 = {
        body: {
          id: 'shipping-method-3'
        }
      };
      mockShippingMethods.execute.mockResolvedValue(mockShippingMethod3);
      expect(await taxCodeService.getShippingTaxCodeFromShippingInfo(shippingInfo3)).toBeNull();
    });
  });

  describe('getShippingMethodById', () => {
    it('should fetch shipping method from API or handle errors', async () => {
      const shippingMethodId = 'shipping-method-1';
      const mockResponse = {
        body: {
          id: 'shipping-method-1',
          name: 'Standard Shipping',
          custom: {
            fields: {
              [TAX_CODE_CUSTOM_TYPE_NAME]: 'txcd_shipping_01'
            }
          }
        }
      };

      mockShippingMethods.execute.mockResolvedValue(mockResponse);
      const result = await taxCodeService.getShippingMethodById(shippingMethodId);
      // The method returns response.body which includes all fields
      expect(result).toEqual(mockResponse.body);
      expect(result.id).toBe('shipping-method-1');
      expect(result.name).toBe('Standard Shipping');
      expect(mockShippingMethods.withId).toHaveBeenCalledWith({ ID: shippingMethodId });

      // Test cache - second call should use cache
      mockShippingMethods.execute.mockClear();
      const cachedResult = await taxCodeService.getShippingMethodById(shippingMethodId);
      expect(cachedResult).toEqual(mockResponse.body);
      expect(mockShippingMethods.execute).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        'Shipping method retrieved from cache',
        { shippingMethodId }
      );

      // Test error
      taxCodeService.clearShippingMethodCache();
      const errorShippingMethodId = 'shipping-method-error';
      const error = new Error('API Error');
      mockShippingMethods.execute.mockRejectedValue(error);
      await expect(
        taxCodeService.getShippingMethodById(errorShippingMethodId)
      ).rejects.toThrow('API Error');
      expect(logger.error).toHaveBeenCalledWith(
        'Error fetching shipping method from API',
        expect.objectContaining({
          shippingMethodId: errorShippingMethodId,
          error: 'API Error'
        })
      );
    });
  });

  describe('logTaxCodeDecision', () => {
    it('should log tax code decision with all details, handling missing properties', () => {
      const testCases = [
        {
          lineItem: {
            id: 'line-item-1',
            productId: 'product-1',
            name: 'Test Product',
            variant: { id: 'variant-1' },
            categories: [
              { id: 'cat-1', key: 'electronics', name: 'Electronics' }
            ]
          },
          taxCode: 'txcd_12345678',
          source: 'custom_type_category'
        },
        {
          lineItem: {
            id: 'line-item-1',
            productId: 'product-1',
            name: 'Test Product',
            categories: []
          },
          taxCode: 'txcd_12345678',
          source: 'custom_type_category'
        },
        {
          lineItem: {
            id: 'line-item-1',
            productId: 'product-1',
            name: 'Test Product',
            categories: [
              { id: 'cat-1' },
              { key: 'electronics' },
              { name: 'Electronics' }
            ]
          },
          taxCode: 'txcd_12345678',
          source: 'custom_type_category'
        }
      ];

      for (const testCase of testCases) {
        taxCodeService.logTaxCodeDecision(
          testCase.lineItem,
          testCase.taxCode,
          testCase.source
        );
        expect(logger.info).toHaveBeenCalledWith(
          'Tax code assigned',
          expect.objectContaining({
            productId: 'product-1',
            taxCode: 'txcd_12345678',
            source: 'custom_type_category'
          })
        );
      }
    });
  });
});
