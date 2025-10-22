import { logger } from '../utils/logger.utils.js';
import configUtils from '../utils/config.util.js';

class TaxBehaviorService {
  constructor() {
  }

  /**
   * Determine tax behavior for cart line items with priority-based fallback logic
   * @param {Object} cartRequest - commercetools cart request
   * @returns {Object} Tax behavior configuration for each line item
   */
  async determineTaxBehaviorForCart(cartRequest) {
    const lineItemBehaviors = {};

    for (const lineItem of cartRequest.lineItems) {
      const behavior = await this.determineTaxBehaviorForLineItem(
        lineItem,
        cartRequest
      );
      lineItemBehaviors[lineItem.id] = behavior;
    }

    return lineItemBehaviors;
  }

  /**
   * Core tax behavior determination logic for individual line items
   * Priority order:
   * 1. Product-specific custom field override
   * 3. Market/Store-based behavior (country mapping)
   * 6. Merchant-wide default configuration
   * 
   * Returns null if no behavior is determined, letting Stripe use automatic behavior
   */
  async determineTaxBehaviorForLineItem(lineItem, cartContext) {
    // Priority 1: Product-specific custom field override
    const customBehavior = this.getCustomFieldBehavior(lineItem);
    if (customBehavior) {
      logger.debug(`Using custom field tax behavior for product ${lineItem.productId}: ${customBehavior}`);
      return customBehavior;
    }

    // Priority 3: Market/Store-based behavior (country mapping)
    const marketBehavior = this.getMarketBasedBehavior(cartContext);
    if (marketBehavior) {
      logger.debug(`Using market-based tax behavior for country ${cartContext.country}: ${marketBehavior}`);
      return marketBehavior;
    }

    // Priority 6: Merchant-wide default configuration
    const merchantBehavior = this.getMerchantDefaultBehavior();
    if (merchantBehavior) {
      logger.debug(`Using merchant default tax behavior: ${merchantBehavior}`);
      return merchantBehavior;
    }

    // No behavior determined - let Stripe use automatic behavior
    logger.debug(`No tax behavior determined for product ${lineItem.productId}, letting Stripe determine automatically`);
    return null;
  }

  /**
   * Get tax behavior from product custom fields
   * Checks both variant-level and product-level custom fields using configurable field name
   */
  getCustomFieldBehavior(lineItem) {
    const customFieldName = this.getCustomFieldName();
    if (!customFieldName) {
      return null;
    }

    // Check variant-level custom field first
    const variantBehavior = lineItem.variant?.custom?.fields?.[customFieldName];
    if (variantBehavior && this.isValidBehavior(variantBehavior)) {
      return variantBehavior.toLowerCase();
    }

    // Check product-level custom field
    const productBehavior = lineItem.custom?.fields?.[customFieldName];
    if (productBehavior && this.isValidBehavior(productBehavior)) {
      return productBehavior.toLowerCase();
    }

    return null;
  }

  /**
   * Get tax behavior based on market/store configuration (country mapping)
   */
  getMarketBasedBehavior(cartContext) {
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
   */
  getMerchantDefaultBehavior() {
    try {
      const config = configUtils.readConfiguration();
      const merchantBehavior = config.taxBehaviorDefault;
      
      if (merchantBehavior && this.isValidBehavior(merchantBehavior)) {
        return merchantBehavior.toLowerCase();
      }
    } catch (error) {
      logger.warn(`Error reading merchant tax behavior configuration: ${error.message}`);
    }

    // No fallback - return null to let Stripe determine behavior
    return null;
  }

  /**
   * Get country to tax behavior mapping from environment variable
   */
  getCountryTaxBehaviorMapping() {
    try {
      const config = configUtils.readConfiguration();
      const countryMappingJson = config.countryTaxBehaviorMapping;
      
      if (countryMappingJson) {
        return JSON.parse(countryMappingJson);
      }
    } catch (error) {
      logger.warn(`Error parsing country tax behavior mapping: ${error.message}`);
    }

    return {};
  }

  /**
   * Get configurable custom field name from environment variable
   * Defaults to 'connectorTaxStripe_TaxBehavior' if not configured
   */
  getCustomFieldName() {
    try {
      const config = configUtils.readConfiguration();
      return config.taxBehaviorCustomFieldName || 'connectorTaxStripe_TaxBehavior';
    } catch (error) {
      logger.warn(`Error reading custom field name configuration: ${error.message}`);
      return 'connectorTaxStripe_TaxBehavior';
    }
  }

  /**
   * Validate tax behavior value
   */
  isValidBehavior(behavior) {
    const validBehaviors = ['inclusive', 'exclusive', 'automatic'];
    return validBehaviors.includes(behavior?.toLowerCase());
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
      decisionReason: this.getDecisionReason(lineItem, cartContext, behavior),
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Determine the reason for the tax behavior decision
   */
  getDecisionReason(lineItem, cartContext, _behavior) {
    // Check if it came from custom field
    if (this.getCustomFieldBehavior(lineItem)) {
      return 'custom_field_override';
    }

    // Check if it came from country mapping
    if (this.getMarketBasedBehavior(cartContext)) {
      return 'country_mapping';
    }

    // Must be merchant default
    return 'merchant_default';
  }
}

export const taxBehaviorService = new TaxBehaviorService();
