// tax-calculator/src/services/category.service.js

import { createApiRoot } from '../clients/create.client.js';
import { logger } from '../utils/logger.utils.js';

/**
 * Category Service
 * 
 * Gets categories for multiple products from commercetools.
 * Uses Product Projections to get expanded categories with their custom types.
 * 
 * 1. Create a Set for unique product IDs
 * 2. If there are no unique product IDs, return an empty Map
 * 3. Check if cache is enabled
 * 4. If cache is enabled, get the categories from cache
 * 5. If cache is not enabled, get the categories from API
 * 6. Save the categories to cache
 * 7. Return the categories
 */
class CategoryService {
  constructor() {
    // In-memory cache: key -> { categories, timestamp }
    this.cache = new Map();
    this.cacheTTL = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Gets expanded categories for multiple products
   * 
   * @param {Array<string>} productIds - Array of product IDs
   * @param {Object} options - Additional options
   * @param {boolean} options.staged - If getting staged version (default: false = current)
   * @param {string} options.locale - Locale for projections (optional)
   * @param {boolean} options.useCache - If using cache (default: true)
   * @returns {Promise<Map<string, Array<Object>>>} Map where key=productId, value=array of expanded categories
   */
  async getCategoriesForProducts(productIds, options = {}) {
    if (!productIds || productIds.length === 0) {
      return new Map();
    }

    const { 
      staged = false, 
      locale,
      useCache = true 
    } = options;

    // Remove duplicates and nulls
    const uniqueProductIds = [...new Set(productIds.filter(Boolean))];
    
    if (uniqueProductIds.length === 0) {
      return new Map();
    }

    logger.info('Fetching categories for products', {
      totalProducts: uniqueProductIds.length,
      staged,
      locale: locale || 'default',
      useCache
    });

    // Check cache if enabled
    if (useCache) {
      const cachedResult = this.getFromCache(uniqueProductIds, staged, locale);
      if (cachedResult) {
        logger.debug('Categories retrieved from cache', {
          productsCount: cachedResult.size
        });
        return cachedResult;
      }
    }

    try {
      // Get categories from API
      const categoriesMap = await this.fetchCategoriesFromAPI(uniqueProductIds, {
        staged,
        locale
      });

      // Save to cache
      if (useCache) {
        this.saveToCache(categoriesMap, staged, locale);
      }

      return categoriesMap;

    } catch (error) {
      logger.error('Error fetching categories for products', {
        productIdsCount: uniqueProductIds.length,
        error: error.message
      });
      throw error;
    }
  }

  /**
    * Gets categories from commercetools API
   * @private
   */
  async fetchCategoriesFromAPI(productIds, options) {
    const { staged = false, locale } = options;

    // If there are more than 500 products, divide into batches
    if (productIds.length > 500) {
      return await this.fetchCategoriesInBatches(productIds, options);
    }

    // Build WHERE predicate
    const idsList = productIds.map(id => `"${id}"`).join(', ');
    const wherePredicate = `id in (${idsList})`;

    const queryArgs = {
      where: wherePredicate,
      staged: staged,
      expand: [
        'categories[*]',
        'categories[*].custom',
        'categories[*].parent',
        'categories[*].parent.custom'
      ],
      limit: 500
    };

    if (locale) {
      queryArgs.locale = locale;
    }

    // Execute query
    const response = await createApiRoot()
      .productProjections()
      .get({ queryArgs })
      .execute();

    const productProjections = response.body.results || [];

    // Extract categories from each product
    const categoriesMap = new Map();
    
    productProjections.forEach(projection => {
      const categories = this.extractCategories(projection);
      categoriesMap.set(projection.id, categories);
      
      logger.debug('Categories extracted for product', {
        productId: projection.id,
        categoriesCount: categories.length,
        hasCustomFields: categories.some(cat => cat.custom?.fields)
      });
    });

    logger.info('Categories fetched from API', {
      requested: productIds.length,
      fetched: categoriesMap.size,
      failed: productIds.length - categoriesMap.size
    });

    return categoriesMap;
  }

  /**
   * Handles queries when there are more than 500 products (commercetools limit)
   * @private
   */
  async fetchCategoriesInBatches(productIds, options) {
    const BATCH_SIZE = 500;
    const batches = [];
    
    for (let i = 0; i < productIds.length; i += BATCH_SIZE) {
      batches.push(productIds.slice(i, i + BATCH_SIZE));
    }

    logger.info('Splitting into batches due to commercetools limit', {
      totalProducts: productIds.length,
      batchCount: batches.length,
      batchSize: BATCH_SIZE
    });

    // Execute all batches in parallel
    const batchPromises = batches.map(batch => 
      this.fetchCategoriesFromAPI(batch, options)
    );

    const batchResults = await Promise.allSettled(batchPromises);

    // Combine results
    const combinedMap = new Map();
    
    batchResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        result.value.forEach((categories, productId) => {
          combinedMap.set(productId, categories);
        });
      } else {
        logger.error('Batch query failed', {
          batchIndex: index,
          batchSize: batches[index].length,
          error: result.reason?.message
        });
      }
    });

    logger.info('All batches processed', {
      totalRequested: productIds.length,
      totalFetched: combinedMap.size
    });

    return combinedMap;
  }

  /**
   * Extracts expanded categories from a Product Projection
   * 
   * @param {Object} productProjection - commercetools Product Projection
   * @returns {Array<Object>} Array of expanded categories with custom types
   */
  extractCategories(productProjection) {
    if (!productProjection?.categories) {
      return [];
    }

    return productProjection.categories
      .map(catRef => {
        // If the category is expanded (has obj), return the full object
        if (catRef.obj) {
          return catRef.obj;
        }
        // If not expanded, return only the basic reference
        return {
          id: catRef.id,
          typeId: catRef.typeId
        };
      })
      .filter(Boolean); // Filter null/undefined
  }

  /**
   * Gets categories from cache
   */
  getFromCache(productIds, staged, locale) {
    const cacheKey = this.getCacheKey(staged, locale);
    const cached = this.cache.get(cacheKey);

    if (!cached) {
      return null;
    }

    // Check if the cache is valid (not expired)
    if (Date.now() - cached.timestamp > this.cacheTTL) {
      this.cache.delete(cacheKey);
      return null;
    }

    // Filter only the products that are in cache
    const result = new Map();
    productIds.forEach(productId => {
      if (cached.categoriesMap.has(productId)) {
        result.set(productId, cached.categoriesMap.get(productId));
      }
    });

    // If we don't have all the products in cache, return null
    if (result.size < productIds.length) {
      return null;
    }

    return result;
  }

  /**
   * Saves categories to cache
   */
  saveToCache(categoriesMap, staged, locale) {
    const cacheKey = this.getCacheKey(staged, locale);
    
    this.cache.set(cacheKey, {
      categoriesMap: categoriesMap,
      timestamp: Date.now()
    });

    logger.debug('Categories saved to cache', {
      cacheKey,
      productsCount: categoriesMap.size
    });
  }

  /**
   * Generates unique key for cache
   */
  getCacheKey(staged, locale) {
    return `categories_${staged ? 'staged' : 'current'}_${locale || 'default'}`;
  }

  /**
   * Clears the cache (useful for testing or when you need to force refresh)
   */
  clearCache() {
    this.cache.clear();
    logger.debug('Cache cleared');
  }

}

// Singleton instance
const categoryService = new CategoryService();

export default categoryService;
export { CategoryService };