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
   * Determine tax behavior for cart line items with priority-based fallback logic.
   *
   * The country mapping is keyed on the **destination** — where the order is delivered — not on
   * `cart.country`. `cart.country` selects prices and is shopper-controlled, so keying on it let
   * a shopper pick the behavior: forcing `inclusive` on a price published as exclusive makes
   * Stripe carve the tax out of the amount instead of adding it, and the merchant remits it from
   * their own margin. Stripe documents that with inclusive behavior "the amount your customer
   * pays remains constant, regardless of the tax amount" (SB3-218).
   *
   * @param {Object} cartRequest - commercetools cart request
   * @param {string|null} destinationCountry - Country of the delivery address for this request
   * @returns {Object} Tax behavior configuration for each line item
   */
  determineTaxBehaviorForCart(cartRequest, destinationCountry = null) {
    // Determine tax behavior once for this destination
    const cartTaxBehavior = this.determineCartTaxBehavior(cartRequest, destinationCountry);

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
  determineCartTaxBehavior(cartContext, destinationCountry = null) {
    // Priority 1: Country-based behavior, keyed on the delivery destination
    const countryBehavior = this.getCountryBasedBehavior(destinationCountry);
    if (countryBehavior) {
      logger.debug(`Using country-based tax behavior for destination ${destinationCountry}: ${countryBehavior}`);
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
   * Get tax behavior based on country mapping configuration.
   *
   * Takes the country code itself rather than the cart, so the caller has to be explicit about
   * *which* country it means. With no destination there is no destination-based rule to apply,
   * and resolution falls through to the merchant default and then to the account's own Stripe
   * Tax setting — which, on Stripe's recommended "Automatic", is currency-based.
   *
   * @param {string|null} countryCode - Destination country code
   * @returns {string|null} Tax behavior, or null if no mapping applies
   */
  getCountryBasedBehavior(countryCode) {
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
   * Clear all caches (useful for testing)
   */
  clearCache() {
    this.configCache = null;
    this.configCacheTimestamp = 0;
    this.countryMappingCache = null;
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
  logBehaviorDecision(lineItem, behavior, cartContext, destinationCountry = null) {
    logger.debug('Tax behavior assignment', {
      productId: lineItem.productId,
      variantId: lineItem.variant?.id,
      assignedBehavior: behavior,
      currency: lineItem.totalPrice?.currencyCode,
      // Both countries are logged on purpose: when they differ, the log is the only place that
      // shows the cart was priced for one market and delivered to another.
      destinationCountry,
      priceSelectionCountry: cartContext?.country,
      decisionReason: this.getDecisionReason(destinationCountry, behavior),
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Determine the reason for the tax behavior decision
   * @param {string|null} destinationCountry - Destination country code
   */
  getDecisionReason(destinationCountry, _behavior) {
    // Check if it came from country mapping
    if (this.getCountryBasedBehavior(destinationCountry)) {
      return 'country_mapping';
    }

    // Must be merchant default
    return 'merchant_default';
  }
}

export const taxBehaviorService = new TaxBehaviorService();
