import { logger } from '../utils/logger.utils.js';
import configUtils from '../utils/config.util.js';
import { VALID_TAX_BEHAVIORS } from '../constants/tax-behavior.constants.js';

class TaxBehaviorService {
  constructor() {
    // Cache for configuration and parsed JSON to avoid repeated I/O and parsing
    this.configCache = null;
    this.configCacheTimestamp = 0;
    this.countryMappingCache = null;
    this.cacheTTL = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Determine tax behavior for cart line items with priority-based fallback logic
   * Tax behavior is determined once at the cart level and applied to all line items
   * @param {Object} cartRequest - commercetools cart request
   * @returns {Object} Tax behavior configuration for each line item
   */
  determineTaxBehaviorForCart(cartRequest) {
    // Determine tax behavior once at cart level
    const cartTaxBehavior = this.determineCartTaxBehavior(cartRequest);
    
    // Apply the same behavior to all line items
    const lineItemBehaviors = {};
    for (const lineItem of cartRequest.lineItems) {
      lineItemBehaviors[lineItem.id] = cartTaxBehavior;
    }

    return lineItemBehaviors;
  }

  /**
   * Determine tax behavior for the entire cart based on cart context
   * Priority order:
   * 1. Country-based behavior (country mapping)
   * 2. Merchant-wide default configuration
   * 
   * Returns null if no behavior is determined, letting Stripe use its own default behavior
   */
  determineCartTaxBehavior(cartContext) {
    // Priority 1: Country-based behavior (country mapping)
    const countryBehavior = this.getCountryBasedBehavior(cartContext);
    if (countryBehavior) {
      logger.debug(`Using country-based tax behavior for country ${cartContext.country}: ${countryBehavior}`);
      return countryBehavior;
    }

    // Priority 2: Merchant-wide default configuration
    const merchantBehavior = this.getMerchantDefaultBehavior();
    if (merchantBehavior) {
      logger.debug(`Using merchant default tax behavior: ${merchantBehavior}`);
      return merchantBehavior;
    }

    // No behavior determined - let Stripe use its own default behavior
    logger.debug(`No tax behavior determined for cart, letting Stripe use its default behavior`);
    return null;
  }


  /**
   * Get tax behavior based on country mapping configuration
   */
  getCountryBasedBehavior(cartContext) {
    const countryCode = cartContext.country;
    if (!countryCode) {
      return null;
    }

    try {
      const countryMapping = this.getCountryTaxBehaviorMapping();
      const behavior = countryMapping[countryCode.toUpperCase()];
      
      if (behavior && this.isValidBehavior(behavior)) {
        return behavior.toLowerCase();
      }
    } catch (error) {
      logger.warn(`Error reading country tax behavior mapping: ${error.message}`);
    }

    return null;
  }

  /**
   * Get merchant-wide default tax behavior from configuration
   * OPTIMIZED: Uses cached configuration to avoid repeated I/O
   */
  getMerchantDefaultBehavior() {
    try {
      const config = this.getCachedConfiguration();
      const merchantBehavior = config.taxBehaviorDefault;
      
      if (merchantBehavior && this.isValidBehavior(merchantBehavior)) {
        return merchantBehavior.toLowerCase();
      }
    } catch (error) {
      logger.warn(`Error reading merchant tax behavior configuration: ${error.message}`);
    }

    // No fallback - return null to let Stripe use its default behavior
    return null;
  }

  /**
   * Get country to tax behavior mapping from environment variable
   * OPTIMIZED: Uses cached parsed JSON to avoid repeated parsing
   */
  getCountryTaxBehaviorMapping() {
    // Check cache first
    if (this.countryMappingCache && Date.now() - this.configCacheTimestamp < this.cacheTTL) {
      return this.countryMappingCache;
    }
    
    try {
      const config = this.getCachedConfiguration();
      const countryMappingJson = config.countryTaxBehaviorMapping;
      
      if (countryMappingJson) {
        const parsed = JSON.parse(countryMappingJson);
        // Cache the parsed result
        this.countryMappingCache = parsed;
        return parsed;
      }
    } catch (error) {
      logger.warn(`Error parsing country tax behavior mapping: ${error.message}`);
    }

    return {};
  }
  
  /**
   * Get cached configuration to avoid repeated I/O
   * @returns {Object} Configuration object
   * @private
   */
  getCachedConfiguration() {
    // Check if cache is valid
    if (this.configCache && Date.now() - this.configCacheTimestamp < this.cacheTTL) {
      return this.configCache;
    }
    
    // Read and cache configuration
    this.configCache = configUtils.readConfiguration();
    this.configCacheTimestamp = Date.now();
    return this.configCache;
  }


  /**
   * Validate tax behavior value
   */
  isValidBehavior(behavior) {
    return VALID_TAX_BEHAVIORS.includes(behavior?.toLowerCase());
  }

  /**
   * Log tax behavior decision for audit purposes
   */
  logBehaviorDecision(lineItem, behavior, cartContext) {
    logger.debug('Tax behavior assignment', {
      productId: lineItem.productId,
      variantId: lineItem.variant?.id,
      assignedBehavior: behavior,
      currency: lineItem.totalPrice?.currencyCode,
      country: cartContext.country,
      decisionReason: this.getDecisionReason(cartContext, behavior),
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Determine the reason for the tax behavior decision
   */
  getDecisionReason(cartContext, _behavior) {
    // Check if it came from country mapping
    if (this.getCountryBasedBehavior(cartContext)) {
      return 'country_mapping';
    }

    // Must be merchant default
    return 'merchant_default';
  }
}

export const taxBehaviorService = new TaxBehaviorService();
