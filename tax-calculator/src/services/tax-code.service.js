import { logger } from '../utils/logger.utils.js';
import taxCodeMappingConfig from '../config/taxCodeMapping.config.js';
import TaxCodeNotFoundError from '../errors/taxCodeNotFound.error.js';
import { TAX_CODE_CUSTOM_TYPE_NAME } from '../connectors/customTypes.js';
import { createApiRoot } from '../clients/create.client.js';

/**
 * Tax Code Service
 * Determines the appropriate Stripe tax code for products using a simple lookup flow:
 * 1. Check product custom field
 * 2. Look up category in customer's mapping
 * 3. Traverse parent categories until match found
 * 4. Throw error if no mapping found
 */
class TaxCodeService {
  constructor() {
    // Cache for shipping methods to avoid repeated API calls
    this.shippingMethodCache = new Map();
    this.cacheTTL = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Get tax code for a cart line item
   * @param {Object} cartLineItem - commercetools cart line item
   * @param {Object} productCategories - Map of categories for product
   * @returns {string} Stripe tax code (e.g., "txcd_99999999")
   * @throws {TaxCodeNotFoundError} If no tax code can be determined
   */
  getTaxCodeForProduct(cartLineItem, productCategories) {
    logger.debug('getTaxCodeForProduct', { cartLineItem });
    if (!cartLineItem) {
      throw new Error('Cart line item is required');
    }

    try {
      // STRATEGY 1: Check category custom type
      const customTypeCategoryTaxCode = this.getCustomTypeCategoryTaxCode(productCategories || []);
      if (customTypeCategoryTaxCode) {
        this.logTaxCodeDecision(cartLineItem, customTypeCategoryTaxCode, 'custom_type_category');
        return customTypeCategoryTaxCode;
      }

      // STRATEGY 2: Check product custom field
      /*const customFieldTaxCode = this.getCustomFieldTaxCode(cartLineItem);
      if (customFieldTaxCode) {
        this.logTaxCodeDecision(cartLineItem, customFieldTaxCode, 'custom_field');
        return customFieldTaxCode;
      }

      // STRATEGY 3: Look up category in customer's mapping
      const categoryTaxCode = this.getCategoryTaxCode(cartLineItem, productCategories || []);
      if (categoryTaxCode) {
        this.logTaxCodeDecision(cartLineItem, categoryTaxCode, 'category_mapping');
        return categoryTaxCode;
      }

      // STRATEGY 4: Traverse parent categories
      const parentCategoryTaxCode = this.getParentCategoryTaxCode(productCategories || []);
      if (parentCategoryTaxCode) {
        this.logTaxCodeDecision(cartLineItem, parentCategoryTaxCode, 'parent_category');
        return parentCategoryTaxCode;
      }*/

      // STRATEGY 5: No tax code found - throw error
      throw new TaxCodeNotFoundError(
        cartLineItem.productId,
        cartLineItem.name || 'Unknown Product',
        cartLineItem.categories || []
      );

    } catch (error) {
      if (error instanceof TaxCodeNotFoundError) {
        logger.warn('Tax code not found for product', {
          productId: cartLineItem.productId,
          productName: cartLineItem.name,
          categories: (cartLineItem.categories || []).map(cat => cat.name || cat.key)
        });
        throw error;
      }

      // Unexpected error
      logger.error('Unexpected error in tax code determination', {
        error: error.message,
        productId: cartLineItem.productId
      });
      throw error;
    }
  }

  /**
   * Step 1: Check category custom type
   * @param {Array} categories - Array of categories
   * @returns {string|null} Tax code from category custom type or null
   */
  getCustomTypeCategoryTaxCode(categories) {
    
    if (categories.length === 0) {
      return null;
    }
  
    const processedCategories = new Set();
    
    // For each category assigned to the product
    for (const category of categories) {
      const taxCode = this.findFirstTaxCodeInHierarchy(category, processedCategories);
      if (taxCode) {
        return taxCode;
      }
    }
    
    return null;
  }
  
  findFirstTaxCodeInHierarchy(category, processedCategories, depth = 0, maxDepth = 10) {
    if (!category || depth >= maxDepth || processedCategories.has(category.id)) {
      return null;
    }
    
    processedCategories.add(category.id);
    
    // Check if tax code is in the current category
    const taxCode = category.custom?.fields?.[TAX_CODE_CUSTOM_TYPE_NAME];
    if (taxCode) {
      return taxCode;
    }
    
    // Check if tax code is in the parent category
    if (category.parent) {
      const parentCategory = category.parent.obj || category.parent;
      return this.findFirstTaxCodeInHierarchy(parentCategory, processedCategories, depth + 1, maxDepth);
    }
    
    return null;
  }

  /**
   * Step 2: Check if product has custom taxCode field
   * @param {Object} cartLineItem - Cart line item
   * @returns {string|null} Tax code from custom field or null
   */
  getCustomFieldTaxCode(cartLineItem) {
    // Check line item custom fields
    const lineItemTaxCode = cartLineItem.custom?.fields?.[TAX_CODE_CUSTOM_TYPE_NAME];
    if (lineItemTaxCode) {
      logger.debug(`Found tax code in line item custom field: ${lineItemTaxCode}`);
      return lineItemTaxCode;
    }

    // Check variant custom fields
    const variantTaxCode = cartLineItem.variant?.custom?.fields?.[TAX_CODE_CUSTOM_TYPE_NAME];
    if (variantTaxCode) {
      logger.debug(`Found tax code in variant custom field: ${variantTaxCode}`);
      return variantTaxCode;
    }

    return null;
  }

  /**
   * Step 3: Look up category in customer's mapping
   * @param {Object} cartLineItem - Cart line item
   * @param {Array} categories - Array of categories
   * @returns {string|null} Tax code from category mapping or null
   */
  getCategoryTaxCode(cartLineItem, categories) {

    if (categories.length === 0) {
      logger.debug('No categories assigned to product', { productId: cartLineItem.productId });
      return null;
    }

    // Try each category assigned to the product
    for (const category of categories) {
      if (!category.id && !category.key) {
        logger.debug('Category has neither id nor key', { category });
        continue;
      }

      // Pass the entire category object to match by id or key
      const taxCode = taxCodeMappingConfig.getTaxCodeForCategory(category);
      if (taxCode) {
        logger.debug(`Found tax code for category`, {
          categoryId: category.id,
          categoryKey: category.key,
          taxCode
        });
        return taxCode;
      }
    }

    return null;
  }

  /**
   * Step 4: Traverse parent categories until match found
   * @param {Array} categories - Array of categories
   * @returns {string|null} Tax code from parent category or null
   */
  getParentCategoryTaxCode(categories) {

    if (categories.length === 0) {
      return null;
    }

    // For each category, traverse up the parent chain
    for (const category of categories) {
      const taxCode = this.traverseParentChain(category);
      if (taxCode) {
        return taxCode;
      }
    }

    return null;
  }

  /**
   * Recursively traverse parent category chain looking for tax code
   * @param {Object} category - Category object with optional parent reference
   * @param {number} depth - Current depth (prevent infinite loops)
   * @returns {string|null} Tax code if found in parent chain
   */
  traverseParentChain(category, depth = 0) {
    const maxDepth = 10; // Prevent infinite loops

    if (!category || depth >= maxDepth) {
      return null;
    }

    // Check if this category has a parent
    if (!category.parent) {
      logger.debug('No parent category found', { categoryId: category.id, depth });
      return null;
    }

    const parent = category.parent.obj || category.parent;

    if (!parent.id && !parent.key) {
      logger.debug('Parent category has neither id nor key', { parent });
      return null;
    }

    // Look up parent in mapping by passing the entire parent object
    const taxCode = taxCodeMappingConfig.getTaxCodeForCategory(parent);
    if (taxCode) {
      logger.debug(`Found tax code in parent category`, {
        parentId: parent.id,
        parentKey: parent.key,
        taxCode,
        depth
      });
      return taxCode;
    }

    // Recursively check grandparent
    return this.traverseParentChain(parent, depth + 1);
  }

  /**
   * Get shipping tax code from shipping info
   * @param {Object} shippingInfo - Shipping info
   * @returns {string|null} Shipping tax code or null if no tax code can be determined
   */
  async getShippingTaxCodeFromShippingInfo(shippingInfo) {

    const shippingMethod = await this.getShippingMethodById(shippingInfo.shippingMethod.id);

    const customTypeShippingTaxCode = shippingMethod?.custom?.fields?.[TAX_CODE_CUSTOM_TYPE_NAME];
    if (customTypeShippingTaxCode) {
      return customTypeShippingTaxCode;
    } 

    return null;
  }

  /**
   * Fetch shipping method from commercetools API by ID
   * OPTIMIZED: Uses cache to avoid repeated API calls for the same shipping method
   * @param {string} shippingMethodId - Shipping method ID
   * @returns {Promise<Object>} Shipping method object with custom fields
   */
  async getShippingMethodById(shippingMethodId) {
    // Check cache first
    const cached = this.shippingMethodCache.get(shippingMethodId);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      logger.debug('Shipping method retrieved from cache', { shippingMethodId });
      return cached.shippingMethod;
    }
    
    try {
      const apiRoot = createApiRoot();
      const response = await apiRoot
        .shippingMethods()
        .withId({ ID: shippingMethodId })
        .get()
        .execute();
      
      const shippingMethod = response.body;
      
      // Save to cache
      this.shippingMethodCache.set(shippingMethodId, {
        shippingMethod,
        timestamp: Date.now()
      });
      
      logger.debug('Shipping method fetched and cached', { shippingMethodId });
      return shippingMethod;
    } catch (error) {
      logger.error('Error fetching shipping method from API', {
        shippingMethodId,
        error: error.message
      });
      throw error;
    }
  }
  
  /**
   * Clears the shipping method cache (useful for testing or when you need to force refresh)
   */
  clearShippingMethodCache() {
    this.shippingMethodCache.clear();
    logger.debug('Shipping method cache cleared');
  }

  /**
   * Log tax code decision for audit trail
   * @param {Object} cartLineItem - Cart line item
   * @param {string} taxCode - Assigned tax code
   * @param {string} source - Source of tax code (category_custom_type, custom_field, category_mapping, parent_category)
   */
  logTaxCodeDecision(cartLineItem, taxCode, source) {
    logger.info('Tax code assigned', {
      productId: cartLineItem.productId,
      productName: cartLineItem.name,
      variantId: cartLineItem.variant?.id,
      taxCode,
      source,
      categories: (cartLineItem.categories || []).map(cat => ({
        id: cat.id,
        key: cat.key,
        name: cat.name
      })),
      timestamp: new Date().toISOString()
    });
  }
}

// Singleton instance
const taxCodeService = new TaxCodeService();

export default taxCodeService;
export { TaxCodeService };
