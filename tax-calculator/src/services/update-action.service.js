import { logger } from '../utils/logger.utils.js';
import { CART_TAX_CUSTOM_TYPE, CART_TAX_FIELD_NAMES } from '../connectors/customTypes.js';

/**
 * Update Action Service
 * Creates Commercetools update actions from Stripe tax calculations
 * 1. Combines multiple calculations into a single result (only for custom type metadata)
 * 2. Creates cart custom type update action
 * 3. Creates line item tax update actions
 * 4. Creates shipping tax update action(s)
 */
class UpdateActionService {
    
  /**
   * Create cart update actions from multiple Stripe tax calculations
   * @param {Array} calculations - Array of Stripe tax calculation responses
   * @param {Array} shippingInfoGroups - Array of shipping info groups (with shippingKey)
   * @param {Array} requests - Array of Stripe requests
   * @param {Object} cart - Commercetools cart
   * @returns {Array} Array of Commercetools update actions
   */
  createCartUpdateActionsFromMultipleCalculations(calculations, shippingInfoGroups = [], requests = [], cart = null) {
    const updateActions = [];
    
    try {
      // STEP 1: Combine all calculations (only for custom type metadata)
      const combinedCalculation = this.combineCalculations(calculations);
      
      // STEP 2: Create cart custom type update action
      const cartCustomTypeAction = this.createCartCustomTypeUpdateAction(combinedCalculation);
      updateActions.push(cartCustomTypeAction);
      
      // STEP 3: Create line item tax update actions
      // With shippingKey separation, create one action per (lineItemId + shippingKey) combination
      const lineItemActions = this.createLineItemTaxUpdateActions(calculations, shippingInfoGroups);
      updateActions.push(...lineItemActions);
      
      // STEP 4: Create shipping tax update action(s)
      // With shippingKey separation, create one action per shipping method
      if (shippingInfoGroups.length > 0) {
        const shippingActions = this.createMultipleShippingTaxUpdateActions(calculations, shippingInfoGroups, requests, cart);
        updateActions.push(...shippingActions);
      } else {
        const shippingAction = this.createShippingTaxUpdateAction(combinedCalculation);
        if (shippingAction) {
          updateActions.push(shippingAction);
        }
      }
      
      logger.info(`Created ${updateActions.length} cart update actions from ${calculations.length} tax calculations`);
      return updateActions;
      
    } catch (error) {
      logger.error('Error creating cart update actions from multiple calculations:', error);
      throw error;
    }
  }

  /**
   * Combine multiple Stripe tax calculations into a single result
   * NOTE: This combination is ONLY used for custom type metadata.
   * Line items and shipping are processed directly from individual calculations
   * to preserve shippingKey mapping and breakdown precision.
   * @param {Array} calculations - Array of Stripe calculation responses
   * @returns {Object} Combined calculation object (for custom type only)
   */
  combineCalculations(calculations) {
    const allLineItems = calculations.flatMap(calc => calc.line_items?.data || []);
    
    const allTaxBreakdowns = calculations.flatMap(calc => calc.tax_breakdown || []);
    const allShippingTaxBreakdowns = calculations.flatMap(calc => calc.shipping_cost?.tax_breakdown || []);
    
    const combined = {
      calculation_references: calculations.map(calc => calc.id).filter(Boolean),
      amount_total: calculations.reduce((sum, c) => sum + (c.amount_total || 0), 0),
      tax_amount_exclusive: calculations.reduce((sum, c) => sum + (c.tax_amount_exclusive || 0), 0),
      tax_amount_inclusive: calculations.reduce((sum, c) => sum + (c.tax_amount_inclusive || 0), 0),
      currency: calculations[0]?.currency || 'USD',
      currencies: calculations.map(calc => calc.currency.toUpperCase()).filter(Boolean),
      line_items: { data: allLineItems },
      expires_at: calculations.map(calc => new Date(calc.expires_at * 1000).toISOString()).filter(Boolean),
      tax_breakdown: allTaxBreakdowns,
      shipping_cost: {
        amount: calculations.reduce((sum, c) => sum + (c.shipping_cost?.amount || 0), 0),
        amount_tax: calculations.reduce((sum, c) => sum + (c.shipping_cost?.amount_tax || 0), 0),
        tax_breakdown: allShippingTaxBreakdowns
      }
    };
    
    return combined;
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
        [CART_TAX_FIELD_NAMES.CALCULATION_REFERENCES]: calculation.calculation_references || [],
        [CART_TAX_FIELD_NAMES.AMOUNT_TOTAL]: calculation.amount_total,
        [CART_TAX_FIELD_NAMES.TAX_AMOUNT_EXCLUSIVE]: calculation.tax_amount_exclusive,
        [CART_TAX_FIELD_NAMES.TAX_AMOUNT_INCLUSIVE]: calculation.tax_amount_inclusive,
        [CART_TAX_FIELD_NAMES.CURRENCIES]: calculation.currencies,
        [CART_TAX_FIELD_NAMES.EXPIRES_AT]: calculation.expires_at,
        [CART_TAX_FIELD_NAMES.CALCULATION_TIMESTAMP]: new Date().toISOString()
      }
    };
  }

  /**
   * Create line item tax update actions from multiple calculations
   * Creates one action per (lineItemId + shippingKey) combination
   * Each calculation's line items are processed directly with their corresponding shippingKey
   * This ensures precise tax breakdowns without combining or averaging rates
   * @param {Array} calculations - Array of Stripe calculation responses
   * @param {Array} shippingInfoGroups - Array of shipping info groups (with shippingKey)
   * @returns {Array} Array of setLineItemTaxAmount update actions
   */
  createLineItemTaxUpdateActions(calculations, shippingInfoGroups = []) {
    const actions = [];
    
    // Map calculations to their shippingKeys
    // Extract shippingKey from line item metadata (more reliable than index-based mapping)
    const calculationToShippingKey = new Map();
    for (const calculation of calculations) {
      const lineItems = calculation.line_items?.data || [];
      // All line items in a calculation have the same shippingKey in their metadata
      if (lineItems.length > 0 && lineItems[0].metadata?.shippingKey) {
        calculationToShippingKey.set(calculation.id, lineItems[0].metadata.shippingKey);
      }
    }
    
    // Fallback: Use shippingInfoGroups if metadata is not available (backward compatibility)
    if (calculationToShippingKey.size === 0 && shippingInfoGroups.length > 0) {
      for (let i = 0; i < calculations.length && i < shippingInfoGroups.length; i++) {
        const shippingInfo = shippingInfoGroups[i];
        if (shippingInfo?.shippingKey) {
          calculationToShippingKey.set(calculations[i].id, shippingInfo.shippingKey);
        }
      }
    }
    
    // Process each calculation individually
    for (const calculation of calculations) {
      const shippingKey = calculationToShippingKey.get(calculation.id) || null;
      
      // Create actions for line items in this calculation
      const calculationActions = this.createLineItemActionsFromCalculation(
        calculation,
        shippingKey // null for Single mode, shippingKey for Multiple mode
      );
      
      actions.push(...calculationActions);
    }
    
    // Handle duplicates: if same (lineItemId + shippingKey) appears in multiple calculations
    const actionsByKey = new Map();
    const baseAmountsByKey = new Map();
    
    for (const action of actions) {
      const key = `${action.lineItemId}-${action.shippingKey || 'single'}`;
      
      if (actionsByKey.has(key)) {
        // Combine tax amounts
        const existing = actionsByKey.get(key);
        const combinedTaxAmount = existing.externalTaxAmount.totalGross.centAmount + 
                                  action.externalTaxAmount.totalGross.centAmount;
        
        // Calculate effective rate from base amounts
        // effective_rate = totalTaxAmount / totalBaseAmount
        const existingBase = baseAmountsByKey.get(key);
        const newBase = action._baseAmount || 0;
        const totalBase = existingBase + newBase;
        
        let effectiveRate;
        if (totalBase > 0) {
          effectiveRate = combinedTaxAmount / totalBase; // Precise effective rate
        } else {
          // Fallback: average of rates (reverse calculate from rates)
          const existingRate = existing.externalTaxAmount.taxRate.amount;
          const newRate = action.externalTaxAmount.taxRate.amount;
          effectiveRate = (existingRate + newRate) / 2;
        }
        
        existing.externalTaxAmount.totalGross.centAmount = combinedTaxAmount;
        existing.externalTaxAmount.taxRate.amount = effectiveRate;
        baseAmountsByKey.set(key, totalBase);
      } else {
        actionsByKey.set(key, { ...action });
        // Store base amount for effective rate calculation (from lineItemData.amount)
        baseAmountsByKey.set(key, action._baseAmount || 0);
      }
    }
    
    // Remove temporary _baseAmount field before returning
    const finalActions = Array.from(actionsByKey.values()).map(action => {
      const cleanAction = { ...action };
      delete cleanAction._baseAmount;
      return cleanAction;
    });
    
    logger.info(`Created ${finalActions.length} line item tax update actions`);
    return finalActions;
  }

  /**
   * Create line item tax update actions from a single calculation
   * @param {Object} calculation - Stripe tax calculation response
   * @param {string|null} shippingKey - Shipping method key (required for Multiple mode, null for Single)
   * @returns {Array} Array of setLineItemTaxAmount update actions
   */
  createLineItemActionsFromCalculation(calculation, shippingKey = null) {
    const actions = [];
    const lineItems = calculation.line_items?.data || [];
    
    // IMPORTANT: Stripe returns tax_breakdown as a general array
    // that can contain breakdowns of line items and shipping cost
    // It is not explicitly labeled what breakdown corresponds to what line item
    // Therefore, we need to use matching logic to identify the correct breakdown
    const taxBreakdowns = calculation.tax_breakdown || [];
    
    for (const lineItemData of lineItems) {
      // Find tax breakdown for this line item using matching logic
      const taxBreakdown = this.findTaxBreakdownForLineItem(lineItemData, taxBreakdowns);
      
      if (!taxBreakdown) {
        logger.warn(`No tax breakdown found for line item ${lineItemData.reference} in calculation ${calculation.id}`);
        continue;
      }
      
      const taxRateDetails = taxBreakdown.tax_rate_details;
      
      const action = {
        action: "setLineItemTaxAmount",
        lineItemId: lineItemData.reference,
        externalTaxAmount: {
          totalGross: {
            currencyCode: calculation.currency?.toUpperCase() || 'USD',
            centAmount: lineItemData.amount_tax
          },
          taxRate: {
            name: taxRateDetails?.tax_type || 'Tax',
            amount: parseFloat(taxRateDetails?.percentage_decimal || 0) / 100,
            country: taxRateDetails?.country
          }
        },
        _baseAmount: lineItemData.amount // Store base amount for effective rate calculation if duplicates
      };
      
      // Add shippingKey if available (Multiple mode - REQUIRED by Commercetools)
      if (shippingKey) {
        action.shippingKey = shippingKey;
      }
      
      actions.push(action);
    }
    
    return actions;
  }

  /**
   * Find the correct tax breakdown for a line item
   * @param {Object} lineItemTaxData - Line item tax data
   * @param {Array} taxBreakdowns - Available tax breakdowns
   * @returns {Object|null} Matching tax breakdown or null
   */
  findTaxBreakdownForLineItem(lineItemTaxData, taxBreakdowns) {
    // STRATEGY 1: Search for tax breakdown by calculated tax amount
    let breakdown = taxBreakdowns.find(b => {
      if (!b.tax_rate_details?.percentage_decimal) return false;
      
      const expectedTax = Math.round( lineItemTaxData.amount * (parseFloat(b.tax_rate_details.percentage_decimal) / 100));
      const actualTax = lineItemTaxData.amount_tax;
      
      return Math.abs(expectedTax - actualTax) <= 1;
    });
    
    if (breakdown) return breakdown;
    
    // STRATEGY 2: Search for tax breakdown by most common tax type
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
   * Combine shipping costs from multiple calculations for the same shippingKey
   * @param {Object} existing - Existing calculation data
   * @param {Object} calculation - New calculation to combine
   */
  combineShippingCosts(existing, calculation) {
    if (calculation.shipping_cost && existing.calculation.shipping_cost) {
      existing.calculation.shipping_cost.amount = 
        (existing.calculation.shipping_cost.amount || 0) + 
        (calculation.shipping_cost.amount || 0);
      existing.calculation.shipping_cost.amount_tax = 
        (existing.calculation.shipping_cost.amount_tax || 0) + 
        (calculation.shipping_cost.amount_tax || 0);
      
      if (calculation.shipping_cost.tax_breakdown && existing.calculation.shipping_cost.tax_breakdown) {
        existing.calculation.shipping_cost.tax_breakdown = [
          ...(existing.calculation.shipping_cost.tax_breakdown || []),
          ...(calculation.shipping_cost.tax_breakdown || [])
        ];
      }
    } else if (calculation.shipping_cost && !existing.calculation.shipping_cost) {
      existing.calculation.shipping_cost = calculation.shipping_cost;
    }
    
    if (calculation.tax_breakdown && existing.calculation.tax_breakdown) {
      existing.calculation.tax_breakdown = [
        ...(existing.calculation.tax_breakdown || []),
        ...(calculation.tax_breakdown || [])
      ];
    }
  }

  /**
   * Create a shipping tax action with tax = 0
   * @param {string} shippingKey - Shipping method key
   * @param {Object} calculation - Calculation object (for currency/country)
   * @param {Object} cart - Cart object (for fallback values)
   * @returns {Object} Shipping tax action
   */
  createZeroTaxShippingAction(shippingKey, calculation = null, cart = null) {
    return {
      action: "setShippingMethodTaxAmount",
      shippingKey: shippingKey,
      externalTaxAmount: {
        totalGross: {
          currencyCode: calculation?.currency?.toUpperCase() || cart?.totalPrice?.currencyCode || 'USD',
          centAmount: 0
        },
        taxRate: {
          name: 'no_shipping_tax',
          amount: 0,
          country: calculation?.tax_breakdown?.[0]?.tax_rate_details?.country || 
                   cart?.country || 
                   'US'
        }
      }
    };
  }

  /**
   * Map calculations to shippingKeys, combining costs when multiple calculations share the same key
   * @param {Array} calculations - Array of calculations
   * @param {Array} requests - Array of requests (optional)
   * @param {Array} shippingInfoGroups - Array of shipping info groups (optional, for fallback)
   * @param {Map} shippingInfoByKey - Map of shippingInfo by key
   * @returns {Map} Map of calculations by shippingKey
   */
  mapCalculationsByShippingKey(calculations, requests, shippingInfoGroups, shippingInfoByKey) {
    const calculationByShippingKey = new Map();
    
    if (requests && requests.length > 0) {
      for (let i = 0; i < Math.min(calculations.length, requests.length); i++) {
        const request = requests[i];
        const calculation = calculations[i];
        
        if (request?.shippingKey && calculation) {
          const shippingKey = request.shippingKey;
          
          if (calculationByShippingKey.has(shippingKey)) {
            this.combineShippingCosts(calculationByShippingKey.get(shippingKey), calculation);
          } else {
            calculationByShippingKey.set(shippingKey, {
              calculation: { ...calculation },
              shippingInfo: shippingInfoByKey.get(shippingKey)
            });
          }
        }
      }
    } else {
      logger.warn('No requests provided, mapping calculations to shippingInfoGroups by index (may be inaccurate)');
      for (let i = 0; i < Math.min(calculations.length, shippingInfoGroups.length); i++) {
        const calculation = calculations[i];
        const shippingInfo = shippingInfoGroups[i];
        
        if (shippingInfo?.shippingKey && calculation) {
          const shippingKey = shippingInfo.shippingKey;
          
          if (calculationByShippingKey.has(shippingKey)) {
            this.combineShippingCosts(calculationByShippingKey.get(shippingKey), calculation);
          } else {
            calculationByShippingKey.set(shippingKey, {
              calculation: { ...calculation },
              shippingInfo
            });
          }
        }
      }
    }
    
    return calculationByShippingKey;
  }

  /**
   * Find or create tax breakdown for shipping cost
   * @param {Object} calculation - Calculation object
   * @param {number} shippingAmount - Shipping amount
   * @param {number} shippingTaxAmount - Shipping tax amount
   * @returns {Object|null} Tax breakdown or null
   */
  findOrCreateShippingTaxBreakdown(calculation, shippingAmount, shippingTaxAmount) {
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
    
    if (!taxBreakdown && shippingAmount > 0 && shippingTaxAmount > 0) {
      const effectiveRate = shippingTaxAmount / shippingAmount;
      const firstBreakdown = calculation.shipping_cost.tax_breakdown?.[0] || 
                             calculation.tax_breakdown?.[0];
      
      if (firstBreakdown) {
        taxBreakdown = {
          ...firstBreakdown,
          amount: shippingTaxAmount,
          tax_rate_details: {
            ...firstBreakdown.tax_rate_details,
            percentage_decimal: (effectiveRate * 100).toFixed(4)
          }
        };
      }
    }
    
    return taxBreakdown;
  }

  /**
   * Create multiple shipping tax update actions (one per shipping method)
   * Each calculation maps directly to its shipping method via shippingKey
   * @param {Array} calculations - Array of Stripe calculations
   * @param {Array} shippingInfoGroups - Array of shipping info groups (with shippingKey)
   * @param {Array} requests - Array of Stripe requests
   * @param {Object} cart - Commercetools cart
   * @returns {Array} Array of shipping tax update actions
   */
  createMultipleShippingTaxUpdateActions(calculations, shippingInfoGroups, requests = [], cart = null) {
    const shippingActions = [];
    
    if (shippingInfoGroups.length === 0 && (!cart || !cart.shipping || cart.shipping.length === 0)) {
      logger.warn('createMultipleShippingTaxUpdateActions called with empty shippingInfoGroups and no cart.shipping');
      return shippingActions;
    }
    
    const shippingInfoByKey = new Map();
    shippingInfoGroups.forEach(sig => {
      if (sig?.shippingKey) {
        shippingInfoByKey.set(sig.shippingKey, sig);
      }
    });
    
    const calculationByShippingKey = this.mapCalculationsByShippingKey(
      calculations, 
      requests, 
      shippingInfoGroups, 
      shippingInfoByKey
    );
    
    const allShippingMethods = cart?.shipping || [];
    const shippingKeysToProcess = allShippingMethods.length > 0
      ? allShippingMethods.map(s => s.shippingKey).filter(Boolean)
      : Array.from(shippingInfoByKey.keys());
    
    for (const shippingKey of shippingKeysToProcess) {
      const mappedData = calculationByShippingKey.get(shippingKey);
      const shippingInfo = shippingInfoByKey.get(shippingKey);
      
      if (mappedData && mappedData.calculation) {
        const { calculation } = mappedData;
        
        if (!shippingInfo) {
          logger.warn(`No shippingInfo found for shippingKey ${shippingKey}, using calculation data`);
        }
        
        if (!calculation.shipping_cost || calculation.shipping_cost.amount_tax <= 0) {
          shippingActions.push(this.createZeroTaxShippingAction(shippingKey, calculation, cart));
          continue;
        }
        
        const shippingAmount = calculation.shipping_cost.amount;
        const shippingTaxAmount = calculation.shipping_cost.amount_tax;
        
        const taxBreakdown = this.findOrCreateShippingTaxBreakdown(
          calculation, 
          shippingAmount, 
          shippingTaxAmount
        );
        
        if (!taxBreakdown) {
          logger.warn(`No tax breakdown found for shipping method ${shippingKey}, creating action with tax = 0`);
          shippingActions.push(this.createZeroTaxShippingAction(shippingKey, calculation, cart));
          continue;
        }
        
        const taxRateDetails = taxBreakdown.tax_rate_details;
        
        shippingActions.push({
          action: "setShippingMethodTaxAmount",
          shippingKey: shippingKey,
          externalTaxAmount: {
            totalGross: {
              currencyCode: calculation.currency?.toUpperCase() || cart?.totalPrice?.currencyCode || 'USD',
              centAmount: shippingTaxAmount
            },
            taxRate: {
              name: taxRateDetails.tax_type || 'shipping_tax',
              amount: parseFloat(taxRateDetails.percentage_decimal || 0) / 100,
              country: taxBreakdown.jurisdiction?.country || taxRateDetails.country
            }
          }
        });
        
      } else {
        logger.info(`No calculation found for shippingKey ${shippingKey}, creating action with tax = 0`);
        shippingActions.push(this.createZeroTaxShippingAction(shippingKey, null, cart));
      }
    }
    
    logger.info(`Created ${shippingActions.length} shipping tax update actions for ${shippingKeysToProcess.length} shipping methods`);
    return shippingActions;
  }

  /**
   * Create shipping tax update action if shipping cost exists
   * @param {Object} calculation - Stripe tax calculation response object
   * @returns {Object|null} Commercetools setShippingMethodTaxAmount update action or null
   */
  createShippingTaxUpdateAction(calculation) {
    if (!calculation.shipping_cost || calculation.shipping_cost.amount_tax <= 0) 
      return {
        action: "setShippingMethodTaxAmount",
        externalTaxAmount: {
          totalGross: {
            currencyCode: calculation.currency?.toUpperCase(),
            centAmount: 0
          },
          taxRate: {
            name: 'no_shipping_tax',
            amount: 0,
            country: calculation.tax_breakdown?.[0]?.tax_rate_details?.country || 'US'
          }
        }
      };
    
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
          name: taxRateDetails.tax_type || 'shipping_tax',
          amount: parseFloat(taxRateDetails.percentage_decimal || 0) / 100,
          country: taxBreakdown.jurisdiction?.country || taxRateDetails.country
        }
      }
    };
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
}

// Singleton instance
const updateActionService = new UpdateActionService();

export default updateActionService;
export { UpdateActionService };