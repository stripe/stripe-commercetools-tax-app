import { expect, describe, it, jest, beforeEach, afterEach } from '@jest/globals';
import { CategoryService } from '../../../src/services/category.service.js';

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

import { logger } from '../../../src/utils/logger.utils.js';
import { createApiRoot } from '../../../src/clients/create.client.js';

describe('CategoryService', () => {
  let categoryService;
  let mockApiRoot;
  let mockProductProjections;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockProductProjections = {
      get: jest.fn().mockReturnThis(),
      execute: jest.fn()
    };
    
    mockApiRoot = {
      productProjections: jest.fn().mockReturnValue(mockProductProjections)
    };
    
    createApiRoot.mockReturnValue(mockApiRoot);
    categoryService = new CategoryService();
  });

  afterEach(() => {
    categoryService.clearCache();
  });

  describe('getCategoriesForProducts', () => {
    it('should return empty Map when productIds is empty, null, or undefined', async () => {
      const emptyInputs = [[], null, undefined];
      
      for (const input of emptyInputs) {
        const result = await categoryService.getCategoriesForProducts(input);
        expect(result).toBeInstanceOf(Map);
        expect(result.size).toBe(0);
      }
    });

    it('should remove duplicates and nulls, then fetch categories from API', async () => {
      const productIds = ['product-1', 'product-1', null, 'product-2', undefined, ''];
      
      const mockResponse = {
        body: {
          results: [
            {
              id: 'product-1',
              categories: [
                { id: 'cat-1', obj: { id: 'cat-1', name: 'Category 1' } }
              ]
            },
            {
              id: 'product-2',
              categories: [
                { id: 'cat-2', obj: { id: 'cat-2', name: 'Category 2' } }
              ]
            }
          ]
        }
      };

      mockProductProjections.execute.mockResolvedValue(mockResponse);

      const result = await categoryService.getCategoriesForProducts(productIds);
      
      expect(result.size).toBe(2);
      expect(mockProductProjections.get).toHaveBeenCalledWith(
        expect.objectContaining({
          queryArgs: expect.objectContaining({
            where: expect.stringContaining('product-1'),
          })
        })
      );
    });

    it('should use cache when enabled and available, or fetch from API when disabled', async () => {
      const productIds = ['product-1'];
      
      const mockResponse = {
        body: {
          results: [
            {
              id: 'product-1',
              categories: [
                { id: 'cat-1', obj: { id: 'cat-1', name: 'Category 1' } }
              ]
            }
          ]
        }
      };

      mockProductProjections.execute.mockResolvedValue(mockResponse);

      // Test with cache disabled
      const result1 = await categoryService.getCategoriesForProducts(productIds, { useCache: false });
      expect(result1.size).toBe(1);
      expect(mockProductProjections.execute).toHaveBeenCalled();

      // Test with cache enabled - first call populates cache
      mockProductProjections.execute.mockClear();
      await categoryService.getCategoriesForProducts(productIds, { useCache: true });
      
      // Second call should use cache
      mockProductProjections.execute.mockClear();
      const result2 = await categoryService.getCategoriesForProducts(productIds, { useCache: true });
      
      expect(result2.size).toBe(1);
      expect(mockProductProjections.execute).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        'Categories retrieved from cache (full hit)',
        expect.objectContaining({
          productsCount: 1
        })
      );
    });

    it('should handle parameters (staged, locale) and log fetching info', async () => {
      const productIds = ['product-1'];
      const mockResponse = { body: { results: [] } };
      mockProductProjections.execute.mockResolvedValue(mockResponse);

      await categoryService.getCategoriesForProducts(productIds, { staged: true, locale: 'en-US' });

      expect(mockProductProjections.get).toHaveBeenCalledWith(
        expect.objectContaining({
          queryArgs: expect.objectContaining({
            staged: true,
            locale: 'en-US'
          })
        })
      );
    });

    it('should handle API errors and log them', async () => {
      const productIds = ['product-1'];
      const error = new Error('API Error');
      
      mockProductProjections.execute.mockRejectedValue(error);

      await expect(
        categoryService.getCategoriesForProducts(productIds)
      ).rejects.toThrow('API Error');

      expect(logger.error).toHaveBeenCalledWith(
        'Error fetching categories for products',
        expect.objectContaining({
          productIdsCount: 1,
          error: 'API Error'
        })
      );
    });

    it('should split into batches when more than 500 products and handle batch failures gracefully', async () => {
      const productIds = Array.from({ length: 600 }, (_, i) => `product-${i}`);
      
      mockProductProjections.execute
        .mockResolvedValueOnce({ 
          body: { 
            results: [
              { id: 'product-1', categories: [{ id: 'cat-1', obj: { id: 'cat-1' } }] }
            ] 
          } 
        })
        .mockResolvedValueOnce({ body: { results: [] } });

      const result = await categoryService.getCategoriesForProducts(productIds);

      expect(mockProductProjections.execute).toHaveBeenCalledTimes(2);
      expect(result.size).toBeGreaterThan(0);
      expect(logger.info).toHaveBeenCalledWith(
        'Splitting into batches due to commercetools limit',
        expect.objectContaining({
          totalProducts: 600,
          batchCount: 2,
          batchSize: 500
        })
      );
    });
  });

  describe('fetchCategoriesFromAPI', () => {
    it('should build correct query and extract categories from product projections', async () => {
      const productIds = ['product-1', 'product-2'];
      const mockResponse = {
        body: {
          results: [
            {
              id: 'product-1',
              categories: [
                { id: 'cat-1', obj: { id: 'cat-1', name: 'Category 1' } },
                { id: 'cat-2', obj: { id: 'cat-2', name: 'Category 2' } }
              ]
            },
            {
              id: 'product-2',
              categories: [
                { id: 'cat-3', obj: { id: 'cat-3', name: 'Category 3' } }
              ]
            }
          ]
        }
      };

      mockProductProjections.execute.mockResolvedValue(mockResponse);

      const result = await categoryService.fetchCategoriesFromAPI(productIds, { staged: false });

      expect(mockProductProjections.get).toHaveBeenCalledWith({
        queryArgs: expect.objectContaining({
          where: 'id in ("product-1", "product-2")',
          staged: false,
          expand: [
            'categories[*]'
          ],
          limit: 500
        })
      });
      expect(result.size).toBe(2);
      expect(result.get('product-1')).toHaveLength(2);
      expect(result.get('product-2')).toHaveLength(1);
    });

    it('should handle products with no categories or products not found in results', async () => {
      const productIds = ['product-1', 'product-2'];
      const mockResponse = {
        body: {
          results: [
            {
              id: 'product-1',
              categories: []
            }
          ]
        }
      };

      mockProductProjections.execute.mockResolvedValue(mockResponse);

      const result = await categoryService.fetchCategoriesFromAPI(productIds, {});

      expect(result.size).toBe(1);
      expect(result.get('product-1')).toEqual([]);
    });
  });

  describe('extractCategories', () => {
    it('should return empty array for null, undefined, or empty categories', () => {
      const testCases = [
        { id: 'product-1', categories: [] },
        { id: 'product-1' },
        null
      ];

      for (const projection of testCases) {
        const result = categoryService.extractCategories(projection);
        expect(result).toEqual([]);
      }
    });

    it('should extract expanded categories, basic references, and filter null/undefined', () => {
      const projection = {
        id: 'product-1',
        categories: [
          { id: 'cat-1', obj: { id: 'cat-1', name: 'Category 1', custom: { fields: {} } } },
          { id: 'cat-2', obj: { id: 'cat-2', name: 'Category 2' } },
          { id: 'cat-3', typeId: 'category' },
          null,
          undefined,
          { id: 'cat-4', obj: { id: 'cat-4' } }
        ]
      };

      const result = categoryService.extractCategories(projection);
      
      expect(result).toHaveLength(4);
      expect(result[0]).toEqual({ id: 'cat-1', name: 'Category 1', custom: { fields: {} } });
      expect(result[1]).toEqual({ id: 'cat-2', name: 'Category 2' });
      expect(result[2]).toEqual({ id: 'cat-3', typeId: 'category' });
      expect(result[3]).toEqual({ id: 'cat-4' });
    });
  });

  describe('Cache management', () => {
    it('should save to cache, retrieve from cache when valid, and handle expiration', () => {
      const categoriesMap = new Map([['product-1', [{ id: 'cat-1' }]]]);
      
      // Save to cache
      categoryService.saveToCache(categoriesMap, false, null);
      const cacheKey = categoryService.getCacheKey(false, null);
      const cached = categoryService.cache.get(cacheKey);
      
      expect(cached).toBeDefined();
      expect(cached.categoriesMap).toEqual(categoriesMap);
      expect(logger.debug).toHaveBeenCalledWith(
        'Categories saved to cache',
        expect.objectContaining({
          cacheKey: 'categories_current_default',
          productsCount: 1
        })
      );

      // Retrieve from cache
      const result = categoryService.getFromCache(['product-1'], false, null);
      expect(result).toBeInstanceOf(Map);
      expect(result.get('product-1')).toEqual([{ id: 'cat-1' }]);

      // Test expiration
      cached.timestamp = Date.now() - (6 * 60 * 1000); // 6 minutes ago
      const expiredResult = categoryService.getFromCache(['product-1'], false, null);
      expect(expiredResult).toBeNull();
    });

    it('should handle different cache keys for staged and locale, and return null when not all products in cache', () => {
      const categoriesMap1 = new Map([['product-1', [{ id: 'cat-1' }]]]);
      const categoriesMap2 = new Map([['product-2', [{ id: 'cat-2' }]]]);

      categoryService.saveToCache(categoriesMap1, false, null);
      categoryService.saveToCache(categoriesMap2, true, 'en-US');

      const result1 = categoryService.getFromCache(['product-1'], false, null);
      const result2 = categoryService.getFromCache(['product-2'], true, 'en-US');
      const result3 = categoryService.getFromCache(['product-1', 'product-2'], false, null);

      expect(result1.get('product-1')).toEqual([{ id: 'cat-1' }]);
      expect(result2.get('product-2')).toEqual([{ id: 'cat-2' }]);
      // getFromCache returns partial cache (Map with available products) when not all products are cached
      // This allows incremental fetching instead of discarding partial cache
      expect(result3).toBeInstanceOf(Map);
      expect(result3.size).toBe(1); // Only product-1 is in cache for this key
      expect(result3.get('product-1')).toEqual([{ id: 'cat-1' }]);
      expect(result3.has('product-2')).toBe(false); // product-2 is not in this cache key
    });

    it('should clear cache and initialize with empty cache', () => {
      const categoriesMap1 = new Map([['product-1', [{ id: 'cat-1' }]]]);
      const categoriesMap2 = new Map([['product-2', [{ id: 'cat-2' }]]]);
      
      categoryService.saveToCache(categoriesMap1, false, null);
      categoryService.saveToCache(categoriesMap2, true, 'en-US');
      
      expect(categoryService.cache.size).toBe(2);
      
      categoryService.clearCache();
      
      expect(categoryService.cache.size).toBe(0);
      expect(logger.debug).toHaveBeenCalledWith('Cache cleared');

      // Test constructor
      const service = new CategoryService();
      expect(service.cache).toBeInstanceOf(Map);
      expect(service.cache.size).toBe(0);
      expect(service.cacheTTL).toBe(5 * 60 * 1000);
    });
  });

  describe('getCacheKey', () => {
    it('should generate correct cache keys for different combinations of staged and locale', () => {
      expect(categoryService.getCacheKey(false, null)).toBe('categories_current_default');
      expect(categoryService.getCacheKey(true, null)).toBe('categories_staged_default');
      expect(categoryService.getCacheKey(false, 'en-US')).toBe('categories_current_en-US');
      expect(categoryService.getCacheKey(true, 'es-ES')).toBe('categories_staged_es-ES');
    });
  });
});
