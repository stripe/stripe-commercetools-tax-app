import { logger } from '../utils/logger.utils.js';
import { CART_TAX_CUSTOM_TYPE, CART_TAX_FIELD_NAMES } from '../connectors/customTypes.js';

/**
 * Service for creating Commercetools Update Actions
 * Handles creation of update actions for carts, orders, and other resources
 * Based on Commercetools Update Actions API
 */
class UpdateActionService {
    
  /**
   * Create cart update actions from Stripe tax calculation
   * @param {Object} calculation - Stripe tax calculation response object
   * @param {Object} cartRequestBody - Cart request body object
   * @returns {Array} Array of Commercetools update actions
   */
  createCartUpdateActionsFromTaxCalculation(calculation, cartRequestBody) {
    const updateActions = [];
    
    try {
      // 1. Create cart custom type update action
      const cartCustomTypeAction = this.createCartCustomTypeUpdateAction(calculation);
      updateActions.push(cartCustomTypeAction);
      
      // 2. Create line item tax update actions
      const lineItemActions = this.createLineItemTaxUpdateActions(calculation);
      updateActions.push(...lineItemActions);
      
      // 3. Create shipping tax update action (if applicable)
      const shippingAction = this.createShippingTaxUpdateAction(calculation);
      if (shippingAction) {
        updateActions.push(shippingAction);
      } else {

        if (cartRequestBody.shippingMode === 'Single') {
          updateActions.push({
            action: "setShippingMethodTaxAmount",
            externalTaxAmount: {
              totalGross: {
                currencyCode: calculation.currency?.toUpperCase(),
                centAmount: 0
              },
              taxRate: {
                name: 'Shipping Tax',
                amount: 0,
                country: calculation.tax_breakdown[0].tax_rate_details.country
              }
            }
          });
        }else {
          const shippingActions = cartRequestBody.shipping.map(shipping => {
            return {
              action: "setShippingMethodTaxAmount",
              shippingKey: shipping.shippingKey,
              externalTaxAmount: {
                totalGross: {
                  currencyCode: calculation.currency?.toUpperCase(),
                  centAmount: 0
                },
                taxRate: {
                  name: 'Shipping Tax',
                  amount: 0,
                  country: calculation.tax_breakdown[0].tax_rate_details.country
                }
              }
            }
          });
          updateActions.push(...shippingActions);
        }
      }
        
      logger.info(`Created ${updateActions.length} cart update actions from tax calculation`);
      return updateActions;
        
    } catch (error) {
      logger.error('Error creating cart update actions:', error);
      throw error;
    }
  }
  
  /**
   * Create cart custom type update action
   * @param {Object} calculation - Stripe tax calculation response object
   * @returns {Object} Commercetools setCustomType update action
   */
  createCartCustomTypeUpdateAction(calculation) {
    return {
      action: "setCustomType",
      type: {
        key: CART_TAX_CUSTOM_TYPE.key,
        typeId: "type"
      },
      fields: {
        [CART_TAX_FIELD_NAMES.CALCULATION_REFERENCE]: calculation.id,
        [CART_TAX_FIELD_NAMES.AMOUNT_TOTAL]: calculation.amount_total,
        [CART_TAX_FIELD_NAMES.TAX_AMOUNT_EXCLUSIVE]: calculation.tax_amount_exclusive,
        [CART_TAX_FIELD_NAMES.TAX_AMOUNT_INCLUSIVE]: calculation.tax_amount_inclusive,
        [CART_TAX_FIELD_NAMES.CURRENCY]: calculation.currency,
        [CART_TAX_FIELD_NAMES.EXPIRES_AT]: new Date(calculation.expires_at * 1000).toISOString(),
        [CART_TAX_FIELD_NAMES.CALCULATION_TIMESTAMP]: new Date().toISOString()
      }
    };
  }
  
  /**
   * Create line item tax update actions
   * @param {Object} calculation - Stripe tax calculation response object
   * @returns {Array} Array of Commercetools setLineItemTaxAmount update actions
   */
  createLineItemTaxUpdateActions(calculation) {
    const updateActions = [];
    const calculatedLineItems = calculation.line_items?.data || [];
    const taxBreakdowns = calculation.tax_breakdown || [];
    
    if (calculatedLineItems.length === 0) {
      logger.warn('No line items found in tax calculation');
      return updateActions;
    }
    
    for (const lineItemTaxData of calculatedLineItems) {
      try {
        const lineItemAction = this.buildLineItemTaxUpdateAction(lineItemTaxData, taxBreakdowns, calculation.currency);
        if (lineItemAction) {
          updateActions.push(lineItemAction);
        }
      } catch (error) {
        logger.error(`Error creating tax update action for line item ${lineItemTaxData.reference}:`, error);
        continue;
      }
    }
      
    return updateActions;
  }
  
  /**
   * Create individual line item tax update action
   * @param {Object} lineItemTaxData - Line item tax data from Stripe response object
   * @param {Array} taxBreakdowns - Tax breakdowns from Stripe
   * @param {String} currency - Currency code
   * @returns {Object|null} Commercetools setLineItemTaxAmount update action or null
   */
  buildLineItemTaxUpdateAction(lineItemTaxData, taxBreakdowns, currency) {
    const taxBreakdown = this.findTaxBreakdownForLineItem(lineItemTaxData, taxBreakdowns);
      
    if (!taxBreakdown) {
      logger.warn(`No tax breakdown found for line item ${lineItemTaxData.reference}`);
      return null;
    }
      
    const taxRateDetails = taxBreakdown.tax_rate_details;
      
    return {
      action: "setLineItemTaxAmount",
      lineItemId: lineItemTaxData.reference,
      externalTaxAmount: {
        totalGross: {
          currencyCode: currency?.toUpperCase(),
          centAmount: lineItemTaxData.amount_tax
        },
        taxRate: {
          name: taxRateDetails.tax_type || 'Tax',
          amount: parseFloat(taxRateDetails.percentage_decimal || 0) / 100,
          country: taxRateDetails.country
        }
      }
    };
  }
  
  /**
   * Create shipping tax update action if shipping cost exists
   * @param {Object} calculation - Stripe tax calculation response object
   * @returns {Object|null} Commercetools setShippingMethodTaxAmount update action or null
   */
  createShippingTaxUpdateAction(calculation) {
    if (!calculation.shipping_cost || calculation.shipping_cost.amount_tax <= 0) return null;
    
    const shippingAmount = calculation.shipping_cost.amount;
    const shippingTaxAmount = calculation.shipping_cost.amount_tax;

    let taxBreakdown = this.findByDirectCalculation(
      shippingAmount, 
      shippingTaxAmount, 
      calculation.shipping_cost.tax_breakdown,
      'shipping'
    );

    if (!taxBreakdown) {
      taxBreakdown = this.findByDirectCalculation(
        shippingAmount, 
        shippingTaxAmount, 
        calculation.tax_breakdown,
        'general'
      );
    }

    if (!taxBreakdown) {
      taxBreakdown = this.findByExactAmount(
        shippingTaxAmount, 
        calculation.shipping_cost.tax_breakdown,
        calculation.tax_breakdown
      );
    }
    
    if (!taxBreakdown) {
      logger.warn('No valid tax breakdown found for shipping cost after trying all 3 alternatives');
      return null;
    }
    
    const taxRateDetails = taxBreakdown.tax_rate_details;
    return {
      action: "setShippingMethodTaxAmount",
      externalTaxAmount: {
        totalGross: {
          currencyCode: calculation.currency?.toUpperCase(),
          centAmount: calculation.shipping_cost.amount_tax
        },
        taxRate: {
          name: taxRateDetails.tax_type || 'Shipping Tax',
          amount: parseFloat(taxRateDetails.percentage_decimal || 0) / 100,
          country: taxBreakdown.jurisdiction?.country
        }
      }
    };
  }
  
  /**
   * Find the correct tax breakdown for a line item
   * @param {Object} lineItemTaxData - Line item tax data
   * @param {Array} taxBreakdowns - Available tax breakdowns
   * @returns {Object|null} Matching tax breakdown or null
   */
  findTaxBreakdownForLineItem(lineItemTaxData, taxBreakdowns) {
    // Step 1: Search for tax breakdown by calculated tax amount
    let breakdown = taxBreakdowns.find(b => {
      if (!b.tax_rate_details?.percentage_decimal) return false;
      
      const expectedTax = Math.round( lineItemTaxData.amount * (parseFloat(b.tax_rate_details.percentage_decimal) / 100));
      const actualTax = lineItemTaxData.amount_tax;
      
      return Math.abs(expectedTax - actualTax) <= 1;
    });
    
    if (breakdown) return breakdown;
    
    // Step 2: Search for tax breakdown by most common tax type
    const taxTypeCounts = {};
    taxBreakdowns.forEach(b => {
      const taxType = b.tax_rate_details?.tax_type;
      if (taxType) {
        taxTypeCounts[taxType] = (taxTypeCounts[taxType] || 0) + 1;
      }
    });
    
    const mostCommonTaxType = Object.keys(taxTypeCounts).length > 0 
      ? Object.keys(taxTypeCounts).reduce((a, b) => 
          taxTypeCounts[a] > taxTypeCounts[b] ? a : b
        )
      : null;
    
    breakdown = taxBreakdowns.find(
      b => b.tax_rate_details?.tax_type === mostCommonTaxType
    );
    
    return breakdown;
  }

    /**
   * Find tax breakdown by direct calculation
   * @param {Number} baseAmount - Base amount for the calculation
   * @param {Number} expectedTaxAmount - Expected tax amount
   * @param {Array} taxBreakdowns - Array of tax breakdowns
   * @param {String} context - Context for logging
   * @returns {Object|null} Tax breakdown found or null
   */
  findByDirectCalculation(baseAmount, expectedTaxAmount, taxBreakdowns, context) {
    if (!taxBreakdowns || taxBreakdowns.length === 0) return null;
    
    for (const breakdown of taxBreakdowns) {
      const taxRateDetails = breakdown.tax_rate_details;
      if (!taxRateDetails?.percentage_decimal) continue;
      
      const taxRate = parseFloat(taxRateDetails.percentage_decimal) / 100;
      const calculatedTax = Math.round(baseAmount * taxRate);
      
      if (Math.abs(calculatedTax - expectedTaxAmount) <= 1) {
        logger.info(`Found ${context} tax breakdown by direct calculation: ${taxRateDetails.tax_type} (${taxRateDetails.percentage_decimal}%) - Expected: ${calculatedTax}, Actual: ${expectedTaxAmount}`);
        return breakdown;
      }
    }
    
    return null;
  }

  /**
   * Find tax breakdown by exact amount
   * @param {Number} expectedAmount - Expected amount
   * @param {Array} shippingBreakdowns - Tax breakdowns for shipping
   * @param {Array} generalBreakdowns - Tax breakdowns for general
   * @returns {Object|null} Tax breakdown found or null
   */
  findByExactAmount(expectedAmount, shippingBreakdowns, generalBreakdowns) {
    let breakdown = shippingBreakdowns?.find(b => b.amount === expectedAmount);
    
    if (!breakdown) {
      breakdown = generalBreakdowns?.find(b => b.amount === expectedAmount);
    }
    
    if (breakdown) {
      logger.info(`Found tax breakdown by exact amount: ${breakdown.tax_rate_details?.tax_type}`);
    }
    
    return breakdown;
  }
  
  /**
   * Validate tax calculation data
   * @param {Object} calculation - Stripe tax calculation response object
   * @returns {Object} Validation result
   */
  validateTaxCalculation(calculation) {
    const errors = [];
    
    if (!calculation.id) {
      errors.push('Missing calculation ID');
    }
    
    if (!calculation.currency) {
      errors.push('Missing currency');
    }
    
    if (!calculation.tax_breakdown || calculation.tax_breakdown.length === 0) {
      errors.push('No tax breakdown available');
    }
    
    if (!calculation.line_items?.data || calculation.line_items.data.length === 0) {
      errors.push('No line items available');
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }
}

export default new UpdateActionService();