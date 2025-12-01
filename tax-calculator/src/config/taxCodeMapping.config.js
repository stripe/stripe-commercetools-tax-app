import { logger } from '../utils/logger.utils.js';

/**
 * Tax Code Mapping Configuration
 * Loads customer-specific category to tax code mappings from environment variable
 */
class TaxCodeMappingConfig {
  constructor() {
    this.mapping = null;
    this.lastLoadedAt = null;
  }

  /**
   * Load and parse tax code mapping from environment variable
   * @returns {Object} Parsed mapping object
   */
  loadMapping() {
    // Return cached mapping if available
    if (this.mapping) {
      logger.debug('Using cached tax code mapping');
      return this.mapping;
    }

    const mappingJson = process.env.TAX_CODE_CATEGORY_MAPPING_JSON;

    if (!mappingJson) {
      logger.warn('TAX_CODE_CATEGORY_MAPPING_JSON environment variable not set. Tax code lookup will rely on product custom fields only.');
      this.mapping = { categories: [] };
      this.lastLoadedAt = Date.now();
      return this.mapping;
    }

    try {
      const parsed = JSON.parse(mappingJson);
      this.validateMapping(parsed);
      this.mapping = parsed;
      this.lastLoadedAt = Date.now();

      logger.info('Tax code mapping loaded successfully', {
        categoryCount: this.mapping.categories?.length || 0,
        timestamp: new Date().toISOString()
      });

      return this.mapping;
    } catch (error) {
      logger.error('Failed to parse TAX_CODE_CATEGORY_MAPPING_JSON', {
        error: error.message,
        rawValue: mappingJson?.substring(0, 100) // Log first 100 chars for debugging
      });
      throw new Error(`Invalid TAX_CODE_CATEGORY_MAPPING_JSON format: ${error.message}`);
    }
  }

  /**
   * Validate the structure of the mapping configuration
   * @param {Object} mapping - Parsed mapping object
   * @throws {Error} If mapping structure is invalid
   */
  validateMapping(mapping) {
    if (!mapping || typeof mapping !== 'object') {
      throw new Error('Mapping must be a valid JSON object');
    }

    if (!mapping.categories || !Array.isArray(mapping.categories)) {
      throw new Error('Mapping must contain a "categories" array');
    }

    // Validate each category mapping
    for (let i = 0; i < mapping.categories.length; i++) {
      const entry = mapping.categories[i];

      if (!entry.ctCategory || typeof entry.ctCategory !== 'object') {
        throw new Error(
          `Category entry at index ${i} must contain a "ctCategory" object`
        );
      }

      if (!entry.ctCategory.id && !entry.ctCategory.key) {
        throw new Error(
          `Category entry at index ${i}: ctCategory must have either "id" or "key" property`
        );
      }

      if (!entry.taxCode || typeof entry.taxCode !== 'string' || !entry.taxCode.startsWith('txcd_')) {
        throw new Error(
          `Category entry at index ${i}: Invalid tax code "${entry.taxCode}". Tax codes must be strings starting with "txcd_"`
        );
      }
    }

    logger.debug('Tax code mapping validation passed', {
      categories: mapping.categories.length
    });
  }

  /**
   * Get tax code for a specific category by id or key
   * @param {Object} category - commercetools category object with id and/or key
   * @returns {string|null} Tax code if found, null otherwise
   */
  getTaxCodeForCategory(category) {
    if (!category || typeof category !== 'object') {
      logger.debug('Invalid category provided', { category });
      return null;
    }

    const mapping = this.loadMapping();

    // Search through categories array to find matching id or key
    for (const entry of mapping.categories) {
      const ctCategory = entry.ctCategory;

      // Match by id (if both have id)
      if (category.id && ctCategory.id && category.id === ctCategory.id) {
        logger.debug(`Tax code found for category id "${category.id}"`, {
          taxCode: entry.taxCode
        });
        return entry.taxCode;
      }

      // Match by key (if both have key)
      if (category.key && ctCategory.key && category.key === ctCategory.key) {
        logger.debug(`Tax code found for category key "${category.key}"`, {
          taxCode: entry.taxCode
        });
        return entry.taxCode;
      }
    }

    logger.debug('No tax code mapping found for category', {
      categoryId: category.id,
      categoryKey: category.key
    });

    return null;
  }
}

// Singleton instance
const taxCodeMappingConfig = new TaxCodeMappingConfig();

export default taxCodeMappingConfig;
