import { logger } from '../utils/logger.utils.js';
import { CART_TAX_CUSTOM_TYPE, CART_TAX_FIELD_NAMES } from '../connectors/customTypes.js';

/**
 * Update Action Service
 * Creates Commercetools update actions from Stripe tax calculations
 * 1. Combines multiple calculations into a single result (only for custom type metadata)
 * 2. Creates cart custom type update action
 * 3. Creates line item tax update actions
 * 4. Creates shipping tax update action(s)
 * 5. Creates cart total tax action (REQUIRED for ExternalAmount tax mode)
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
      
      // STEP 3b: Create line item total price update actions (to update cart.totalPrice without taxes)
      // This sets totalPrice to the base amount (without tax), so CommerceTools can correctly calculate totalTax
      // IMPORTANT: This must be done BEFORE tax actions to ensure we can match line items
      const lineItemTotalPriceActions = this.createLineItemTotalPriceActions(calculations, shippingInfoGroups);
      updateActions.push(...lineItemTotalPriceActions);
      
      // STEP 3: Create line item tax update actions
      // With shippingKey separation, create one action per (lineItemId + shippingKey) combination
      // IMPORTANT: This must include ALL line items that have setLineItemTotalPrice
      const lineItemActions = this.createLineItemTaxUpdateActions(calculations, shippingInfoGroups, lineItemTotalPriceActions, cart);
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
      
      // STEP 5: Create cart total tax action (REQUIRED for ExternalAmount tax mode)
      // This sets the cart's taxedPrice.totalGross, which CommerceTools uses to calculate totalTax
      const cartTotalTaxAction = this.createCartTotalTaxAction(combinedCalculation);
      if (cartTotalTaxAction) {
        updateActions.push(cartTotalTaxAction);
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
    // Initialize accumulator object
    const accumulator = {
      allLineItems: [],
      allTaxBreakdowns: [],
      allShippingTaxBreakdowns: [],
      calculationReferences: [],
      currencies: [],
      expiresAt: [],
      amountTotal: 0,
      taxAmountExclusive: 0,
      taxAmountInclusive: 0,
      shippingAmount: 0,
      shippingAmountTax: 0,
      firstCurrency: null
    };
    
    // Single pass through all calculations
    for (const calc of calculations) {
      // Process arrays and breakdowns (line items, tax breakdowns)
      this.processArraysAndBreakdowns(calc, accumulator);
      
      // Process amounts and metadata (amounts, references, currencies, expires_at, firstCurrency)
      this.processAmountsAndMetadata(calc, accumulator);
    }
    
    // Build and return combined result
    return this.buildCombinedResult(accumulator);
  }

  /**
   * Process arrays and tax breakdowns from a calculation
   * Accumulates line items, tax breakdowns, and shipping tax breakdowns
   * @param {Object} calc - Stripe calculation response
   * @param {Object} accumulator - Accumulator object to store results
   * @private
   */
  processArraysAndBreakdowns(calc, accumulator) {
    // Accumulate line items
    if (calc.line_items?.data) {
      accumulator.allLineItems.push(...calc.line_items.data);
    }
    
    // Accumulate tax breakdowns
    if (calc.tax_breakdown) {
      accumulator.allTaxBreakdowns.push(...calc.tax_breakdown);
    }
    
    // Accumulate shipping tax breakdowns
    if (calc.shipping_cost?.tax_breakdown) {
      accumulator.allShippingTaxBreakdowns.push(...calc.shipping_cost.tax_breakdown);
    }
  }

  /**
   * Process amounts and metadata from a calculation
   * Accumulates amounts, calculation references, currencies, expires_at, and captures first currency
   * @param {Object} calc - Stripe calculation response
   * @param {Object} accumulator - Accumulator object to store results
   * @private
   */
  processAmountsAndMetadata(calc, accumulator) {
    // Accumulate amounts (always accumulate, using || 0 for missing values)
    accumulator.amountTotal += calc.amount_total || 0;
    accumulator.taxAmountExclusive += calc.tax_amount_exclusive || 0;
    accumulator.taxAmountInclusive += calc.tax_amount_inclusive || 0;
    accumulator.shippingAmount += calc.shipping_cost?.amount || 0;
    accumulator.shippingAmountTax += calc.shipping_cost?.amount_tax || 0;
    
    // Collect references and metadata
    if (calc.id) {
      accumulator.calculationReferences.push(calc.id);
      accumulator.currencies.push(`${calc.id}_${(calc.currency || 'USD').toUpperCase()}`);
    }
    
    if (calc.expires_at) {
      accumulator.expiresAt.push(`${calc.id}_${new Date(calc.expires_at * 1000).toISOString()}`);
    }
    
    // Capture first currency
    if (!accumulator.firstCurrency && calc.currency) {
      accumulator.firstCurrency = calc.currency;
    }
  }

  /**
   * Build combined calculation result from accumulator
   * Constructs the final combined calculation object with all accumulated data
   * @param {Object} accumulator - Accumulator object with all processed data
   * @returns {Object} Combined calculation object
   * @private
   */
  buildCombinedResult(accumulator) {
    return {
      calculation_references: accumulator.calculationReferences,
      amount_total: accumulator.amountTotal,
      tax_amount_exclusive: accumulator.taxAmountExclusive,
      tax_amount_inclusive: accumulator.taxAmountInclusive,
      currency: accumulator.firstCurrency || 'USD',
      currencies: accumulator.currencies,
      line_items: { data: accumulator.allLineItems },
      expires_at: accumulator.expiresAt,
      tax_breakdown: accumulator.allTaxBreakdowns,
      shipping_cost: {
        amount: accumulator.shippingAmount,
        amount_tax: accumulator.shippingAmountTax,
        tax_breakdown: accumulator.allShippingTaxBreakdowns
      }
    };
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
   * Create cart total tax update action (REQUIRED for ExternalAmount tax mode)
   * Sets the cart's taxedPrice.totalGross, which CommerceTools uses to calculate totalTax
   * The amount_total from Stripe already includes line items + shipping + taxes
   * @param {Object} calculation - Combined Stripe tax calculation response object
   * @returns {Object|null} Commercetools setCartTotalTax update action or null if amount_total is missing
   */
  createCartTotalTaxAction(calculation) {
    if (!calculation.amount_total || calculation.amount_total <= 0) {
      logger.warn('Cannot create cart total tax action: amount_total is missing or zero');
      return null;
    }

    return {
      action: "setCartTotalTax",
      externalTotalGross: {
        currencyCode: calculation.currency?.toUpperCase() || 'USD',
        centAmount: calculation.amount_total
      }
    };
  }

  /**
   * Map calculations to their shippingKeys
   * Extract shippingKey from line item metadata (more reliable than index-based mapping)
   * @param {Array} calculations - Array of Stripe calculation responses
   * @param {Array} shippingInfoGroups - Array of shipping info groups (with shippingKey) for fallback
   * @returns {Map} Map where key=calculation.id, value=shippingKey
   * @private
   */
  mapCalculationsToShippingKeys(calculations, shippingInfoGroups = []) {
    const calculationToShippingKey = new Map();
    
    // Primary strategy: Extract shippingKey from line item metadata
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
    
    return calculationToShippingKey;
  }

  /**
   * Create line item tax update actions from multiple calculations
   * Creates one action per (lineItemId + shippingKey) combination
   * Each calculation's line items are processed directly with their corresponding shippingKey
   * This ensures precise tax breakdowns without combining or averaging rates
   * IMPORTANT: Ensures all line items with setLineItemTotalPrice also have setLineItemTaxAmount
   * @param {Array} calculations - Array of Stripe calculation responses
   * @param {Array} shippingInfoGroups - Array of shipping info groups (with shippingKey)
   * @param {Array} lineItemTotalPriceActions - Array of setLineItemTotalPrice actions (to ensure coverage)
   * @param {Object} cart - Commercetools cart (optional, for fallback country)
   * @returns {Array} Array of setLineItemTaxAmount update actions
   */
  createLineItemTaxUpdateActions(calculations, shippingInfoGroups = [], lineItemTotalPriceActions = [], cart = null) {
    // Map calculations to their shippingKeys
    const calculationToShippingKey = this.mapCalculationsToShippingKeys(calculations, shippingInfoGroups);
    
    // Build initial actions from calculations
    const actions = [];
    for (const calculation of calculations) {
      const shippingKey = calculationToShippingKey.get(calculation.id) || null;
      const calculationActions = this.createLineItemActionsFromCalculation(
        calculation,
        shippingKey, // null for Single mode, shippingKey for Multiple mode
        cart // Pass cart for fallback country
      );
      actions.push(...calculationActions);
    }
    
    // Merge duplicate actions (same lineItemId + shippingKey from multiple calculations)
    const actionsByKey = this.mergeDuplicateTaxActions(actions);
    
    // CRITICAL: Ensure all line items with setLineItemTotalPrice also have setLineItemTaxAmount
    // This is required because setLineItemTotalPrice changes priceMode to ExternalTotal,
    // and CommerceTools requires all ExternalTotal line items to have externalTaxAmount set
    this.ensureMissingTaxActions(actionsByKey, lineItemTotalPriceActions, cart);
    
    // Remove temporary fields and return final actions
    const finalActions = this.removeTemporaryTaxFields(actionsByKey);
    
    logger.info(`Created ${finalActions.length} line item tax update actions`);
    return finalActions;
  }

  /**
   * Merge duplicate tax actions when same (lineItemId + shippingKey) appears in multiple calculations
   * Combines totalGross amounts and calculates effective tax rate based on combined base amounts
   * @param {Array} actions - Array of tax actions that may contain duplicates
   * @returns {Map} Map of merged actions keyed by lineItemId-shippingKey
   * @private
   */
  mergeDuplicateTaxActions(actions) {
    const actionsByKey = new Map();
    const baseAmountsByKey = new Map();
    
    for (const action of actions) {
      const key = `${action.lineItemId}-${action.shippingKey || 'single'}`;
      
      if (actionsByKey.has(key)) {
        // Combine totalGross amounts (which now include base + tax)
        const existing = actionsByKey.get(key);
        const combinedTotalGross = existing.externalTaxAmount.totalGross.centAmount + 
                                  action.externalTaxAmount.totalGross.centAmount;
        
        // Calculate effective rate from base amounts
        // totalGross = base + tax, so we need to extract tax to calculate rate
        const existingBase = baseAmountsByKey.get(key);
        const newBase = action._baseAmount || 0;
        const totalBase = existingBase + newBase;
        
        // Extract tax amounts from totalGross
        const existingTax = existing.externalTaxAmount.totalGross.centAmount - existingBase;
        const newTax = action.externalTaxAmount.totalGross.centAmount - newBase;
        const combinedTax = existingTax + newTax;
        
        // Calculate effective tax rate
        const effectiveRate = this.calculateEffectiveTaxRate(
          totalBase,
          combinedTax,
          existing.externalTaxAmount.taxRate.amount,
          action.externalTaxAmount.taxRate.amount
        );
        
        // Update existing action with combined values
        existing.externalTaxAmount.totalGross.centAmount = combinedTotalGross;
        existing.externalTaxAmount.taxRate.amount = effectiveRate;
        baseAmountsByKey.set(key, totalBase);
      } else {
        actionsByKey.set(key, { ...action });
        // Store base amount for effective rate calculation (from lineItemData.amount)
        baseAmountsByKey.set(key, action._baseAmount || 0);
      }
    }
    
    return actionsByKey;
  }

  /**
   * Calculate effective tax rate from combined amounts or fallback to average of rates
   * @param {number} totalBase - Combined base amount
   * @param {number} combinedTax - Combined tax amount
   * @param {number} existingRate - Existing tax rate
   * @param {number} newRate - New tax rate
   * @returns {number} Effective tax rate
   * @private
   */
  calculateEffectiveTaxRate(totalBase, combinedTax, existingRate, newRate) {
    if (totalBase > 0) {
      return combinedTax / totalBase; // Precise effective rate
    } else {
      // Fallback: average of rates (reverse calculate from rates)
      return (existingRate + newRate) / 2;
    }
  }

  /**
   * Ensure all line items with setLineItemTotalPrice also have setLineItemTaxAmount
   * Creates tax actions with tax = 0 for line items that have totalPrice but no tax calculation
   * This is required because setLineItemTotalPrice changes priceMode to ExternalTotal,
   * and CommerceTools requires all ExternalTotal line items to have externalTaxAmount set
   * @param {Map} actionsByKey - Map of tax actions keyed by lineItemId-shippingKey
   * @param {Array} lineItemTotalPriceActions - Array of setLineItemTotalPrice actions
   * @param {Object} cart - Commercetools cart (optional, for fallback values)
   * @private
   */
  ensureMissingTaxActions(actionsByKey, lineItemTotalPriceActions, cart) {
    const defaultCountry = cart?.country || cart?.shippingAddress?.country || 'US';
    const defaultCurrency = cart?.totalPrice?.currencyCode || 'USD';
    
    for (const totalPriceAction of lineItemTotalPriceActions) {
      const key = `${totalPriceAction.lineItemId}-${totalPriceAction.shippingKey || 'single'}`;
      
      // Check if we already have a tax action for this key
      if (!actionsByKey.has(key)) {
        // This line item has setLineItemTotalPrice but no setLineItemTaxAmount
        // Create a tax action with tax = 0 to satisfy CommerceTools requirement
        logger.warn(`Line item ${totalPriceAction.lineItemId} has setLineItemTotalPrice but no tax calculation. Creating tax action with tax = 0`);
        
        const missingTaxAction = this.createMissingTaxAction(totalPriceAction, defaultCountry, defaultCurrency);
        actionsByKey.set(key, missingTaxAction);
      }
    }
  }

  /**
   * Create a tax action with tax = 0 for a line item that has totalPrice but no tax calculation
   * @param {Object} totalPriceAction - setLineItemTotalPrice action
   * @param {string} defaultCountry - Default country code
   * @param {string} defaultCurrency - Default currency code
   * @returns {Object} setLineItemTaxAmount action with tax = 0
   * @private
   */
  createMissingTaxAction(totalPriceAction, defaultCountry, defaultCurrency) {
    const currencyCode = totalPriceAction.externalTotalPrice?.totalPrice?.currencyCode || 
                        totalPriceAction.externalTotalPrice?.price?.currencyCode || 
                        defaultCurrency;
    const totalPrice = totalPriceAction.externalTotalPrice?.totalPrice?.centAmount || 0;
    
    const missingTaxAction = {
      action: "setLineItemTaxAmount",
      lineItemId: totalPriceAction.lineItemId,
      externalTaxAmount: {
        totalGross: {
          currencyCode: currencyCode,
          centAmount: totalPrice // Use totalPrice as totalGross (tax = 0)
        },
        taxRate: {
          name: 'no_tax',
          amount: 0,
          country: defaultCountry
        }
      }
    };
    
    // Add shippingKey if present in totalPriceAction
    if (totalPriceAction.shippingKey) {
      missingTaxAction.shippingKey = totalPriceAction.shippingKey;
    }
    
    return missingTaxAction;
  }

  /**
   * Remove temporary fields from actions and convert Map to Array
   * Removes the _baseAmount field that was used for effective rate calculation
   * @param {Map} actionsByKey - Map of actions keyed by lineItemId-shippingKey
   * @returns {Array} Array of final actions without temporary fields
   * @private
   */
  removeTemporaryTaxFields(actionsByKey) {
    const finalActions = [];
    
    for (const action of actionsByKey.values()) {
      delete action._baseAmount;
      finalActions.push(action);
    }
    
    return finalActions;
  }

  /**
   * Create line item total price update actions from multiple calculations
   * Updates the totalPrice of line items to the base amount (without taxes)
   * This allows CommerceTools to correctly calculate totalTax = totalGross - totalNet
   * @param {Array} calculations - Array of Stripe calculation responses
   * @param {Array} shippingInfoGroups - Array of shipping info groups (with shippingKey)
   * @returns {Array} Array of setLineItemTotalPrice update actions
   */
  createLineItemTotalPriceActions(calculations, shippingInfoGroups = []) {
    // Map calculations to their shippingKeys (reusing shared method)
    const calculationToShippingKey = this.mapCalculationsToShippingKeys(calculations, shippingInfoGroups);
    
    // Build initial actions from calculations
    const actions = this.buildActionsFromCalculations(calculations, calculationToShippingKey);
    
    // Merge duplicate actions (same lineItemId + shippingKey)
    const mergedActions = this.mergeDuplicateActions(actions);
    
    // Remove temporary fields and return final actions
    const finalActions = this.removeTemporaryFields(mergedActions);
    
    logger.info(`Created ${finalActions.length} line item total price update actions`);
    return finalActions;
  }

  /**
   * Build line item total price actions from calculations
   * Creates one action per line item in each calculation
   * @param {Array} calculations - Array of Stripe calculation responses
   * @param {Map} calculationToShippingKey - Map of calculation IDs to shipping keys
   * @returns {Array} Array of setLineItemTotalPrice actions (may contain duplicates)
   * @private
   */
  buildActionsFromCalculations(calculations, calculationToShippingKey) {
    const actions = [];
    
    for (const calculation of calculations) {
      const shippingKey = calculationToShippingKey.get(calculation.id) || null;
      const lineItems = calculation.line_items?.data || [];
      
      for (const lineItemData of lineItems) {
        const action = this.createLineItemTotalPriceAction(lineItemData, calculation, shippingKey);
        actions.push(action);
      }
    }
    
    return actions;
  }

  /**
   * Create a single line item total price action
   * Sets totalPrice to base amount (without taxes) and calculates unit price
   * @param {Object} lineItemData - Line item data from Stripe calculation
   * @param {Object} calculation - Stripe calculation response
   * @param {string|null} shippingKey - Shipping method key (null for Single mode)
   * @returns {Object} setLineItemTotalPrice action with temporary _quantity field
   * @private
   */
  createLineItemTotalPriceAction(lineItemData, calculation, shippingKey) {
    // Set totalPrice to base amount (without taxes)
    // CommerceTools will set totalNet = totalPrice, and totalTax will be calculated as totalGross - totalNet
    const totalPriceBase = lineItemData.amount;
    const quantity = lineItemData.quantity || 1;
    const currencyCode = calculation.currency?.toUpperCase() || 'USD';
    const unitPrice = quantity > 0 ? Math.round(lineItemData.amount / quantity) : lineItemData.amount;
    
    const action = {
      action: "setLineItemTotalPrice",
      lineItemId: lineItemData.reference,
      externalTotalPrice: {
        price: {
          currencyCode: currencyCode,
          centAmount: unitPrice
        },
        totalPrice: {
          currencyCode: currencyCode,
          centAmount: totalPriceBase
        }
      },
      _quantity: quantity // Store for duplicate handling
    };
    
    // Add shippingKey if available (Multiple mode)
    if (shippingKey) {
      action.shippingKey = shippingKey;
    }
    
    return action;
  }

  /**
   * Merge duplicate actions when same (lineItemId + shippingKey) appears in multiple calculations
   * Combines totalPrice amounts and recalculates unit price based on combined quantity
   * @param {Array} actions - Array of actions that may contain duplicates
   * @returns {Map} Map of merged actions keyed by lineItemId-shippingKey
   * @private
   */
  mergeDuplicateActions(actions) {
    const actionsByKey = new Map();
    
    for (const action of actions) {
      const key = `${action.lineItemId}-${action.shippingKey || 'single'}`;
      
      if (actionsByKey.has(key)) {
        this.combineActionWithExisting(action, actionsByKey.get(key));
      } else {
        actionsByKey.set(key, { ...action });
      }
    }
    
    return actionsByKey;
  }

  /**
   * Combine a new action with an existing action
   * Merges totalPrice amounts and recalculates unit price
   * @param {Object} newAction - New action to combine
   * @param {Object} existingAction - Existing action to update
   * @private
   */
  combineActionWithExisting(newAction, existingAction) {
    // Combine totalPrice amounts
    const combinedTotalPrice = existingAction.externalTotalPrice.totalPrice.centAmount + 
                              newAction.externalTotalPrice.totalPrice.centAmount;
    const combinedQuantity = existingAction._quantity + (newAction._quantity || 1);
    
    // Update existing action with combined values
    existingAction.externalTotalPrice.totalPrice.centAmount = combinedTotalPrice;
    existingAction.externalTotalPrice.price.centAmount = combinedQuantity > 0 
      ? Math.round(combinedTotalPrice / combinedQuantity) 
      : combinedTotalPrice;
    existingAction._quantity = combinedQuantity;
  }

  /**
   * Remove temporary fields from actions and convert Map to Array
   * Removes the _quantity field that was used for duplicate handling
   * @param {Map} actionsByKey - Map of actions keyed by lineItemId-shippingKey
   * @returns {Array} Array of final actions without temporary fields
   * @private
   */
  removeTemporaryFields(actionsByKey) {
    const finalActions = [];
    
    for (const action of actionsByKey.values()) {
      delete action._quantity;
      finalActions.push(action);
    }
    
    return finalActions;
  }

  /**
   * Create line item tax update actions from a single calculation
   * IMPORTANT: Always creates an action for each line item, even if no tax breakdown is found.
   * This is required because setLineItemTotalPrice changes priceMode to ExternalTotal,
   * and CommerceTools requires all ExternalTotal line items to have externalTaxAmount set.
   * @param {Object} calculation - Stripe tax calculation response
   * @param {string|null} shippingKey - Shipping method key (required for Multiple mode, null for Single)
   * @param {Object} cart - Commercetools cart (optional, for fallback country)
   * @returns {Array} Array of setLineItemTaxAmount update actions
   */
  createLineItemActionsFromCalculation(calculation, shippingKey = null, cart = null) {
    const actions = [];
    const lineItems = calculation.line_items?.data || [];
    
    // IMPORTANT: Stripe returns tax_breakdown as a general array
    // that can contain breakdowns of line items and shipping cost
    // It is not explicitly labeled what breakdown corresponds to what line item
    // Therefore, we need to use matching logic to identify the correct breakdown
    const taxBreakdowns = calculation.tax_breakdown || [];
    
    // Get default country from calculation (from shipping cost or first breakdown)
    // Fallback to cart country if available
    const defaultCountry = calculation.shipping_cost?.tax_breakdown?.[0]?.tax_rate_details?.country ||
                           calculation.tax_breakdown?.[0]?.tax_rate_details?.country ||
                           cart?.country ||
                           cart?.shippingAddress?.country ||
                           'US';
    
    for (const lineItemData of lineItems) {
      // Find tax breakdown for this line item using matching logic
      const taxBreakdown = this.findTaxBreakdownForLineItem(lineItemData, taxBreakdowns);
      
      let taxRateDetails;
      let totalGrossAmount;
      
      if (taxBreakdown) {
        // Use tax breakdown if found
        taxRateDetails = taxBreakdown.tax_rate_details;
        totalGrossAmount = lineItemData.amount + lineItemData.amount_tax;
      } else {
        // No tax breakdown found - create action with tax = 0
        // This is required because setLineItemTotalPrice changes priceMode to ExternalTotal,
        // and CommerceTools requires all ExternalTotal line items to have externalTaxAmount set
        logger.warn(`No tax breakdown found for line item ${lineItemData.reference} in calculation ${calculation.id}. Creating action with tax = 0`);
        taxRateDetails = {
          tax_type: 'no_tax',
          percentage_decimal: '0',
          country: defaultCountry
        };
        // If amount_tax is 0 or missing, use just the amount as totalGross
        totalGrossAmount = lineItemData.amount + (lineItemData.amount_tax || 0);
      }
      
      const action = {
        action: "setLineItemTaxAmount",
        lineItemId: lineItemData.reference,
        externalTaxAmount: {
          totalGross: {
            currencyCode: calculation.currency?.toUpperCase() || 'USD',
            centAmount: totalGrossAmount
          },
          taxRate: {
            name: taxRateDetails?.tax_type || 'Tax',
            amount: parseFloat(taxRateDetails?.percentage_decimal || 0) / 100,
            country: taxRateDetails?.country || defaultCountry
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
    if (!taxBreakdowns || taxBreakdowns.length === 0) {
      return null;
    }
    
    // Precompute tax rates and create lookup maps
    const breakdownsWithRates = this.precomputeBreakdownsWithRates(taxBreakdowns);
    
    // STRATEGY 1: Search for tax breakdown by calculated tax amount (using precomputed rates)
    const breakdown = this.findBreakdownByCalculatedTax(lineItemTaxData, breakdownsWithRates);
    if (breakdown) {
      return breakdown;
    }
    
    // STRATEGY 2: Search for tax breakdown by most common tax type (using precomputed data)
    return this.findBreakdownByMostCommonTaxType(breakdownsWithRates);
  }

  /**
   * Precompute tax rates from tax breakdowns and filter out invalid entries
   * @param {Array} taxBreakdowns - Array of tax breakdowns
   * @returns {Array} Array of objects with breakdown, taxRate, and taxType
   * @private
   */
  precomputeBreakdownsWithRates(taxBreakdowns) {
    return taxBreakdowns.map(breakdown => {
      const percentageDecimal = breakdown.tax_rate_details?.percentage_decimal;
      const taxRate = percentageDecimal ? parseFloat(percentageDecimal) / 100 : null;
      return {
        breakdown,
        taxRate,
        taxType: breakdown.tax_rate_details?.tax_type
      };
    }).filter(b => b.taxRate !== null);
  }

  /**
   * Find tax breakdown by matching calculated tax amount
   * Uses the precomputed tax rates to calculate expected tax and matches against actual tax
   * @param {Object} lineItemTaxData - Line item tax data with amount and amount_tax
   * @param {Array} breakdownsWithRates - Precomputed breakdowns with tax rates
   * @returns {Object|null} Matching tax breakdown or null
   * @private
   */
  findBreakdownByCalculatedTax(lineItemTaxData, breakdownsWithRates) {
    const actualTax = lineItemTaxData.amount_tax;
    const breakdown = breakdownsWithRates.find(({ taxRate }) => {
      const expectedTax = Math.round(lineItemTaxData.amount * taxRate);
      return Math.abs(expectedTax - actualTax) <= 1;
    });
    
    return breakdown ? breakdown.breakdown : null;
  }

  /**
   * Find tax breakdown by most common tax type
   * Counts occurrences of each tax type and returns breakdown for the most common one
   * @param {Array} breakdownsWithRates - Precomputed breakdowns with tax rates and types
   * @returns {Object|null} Tax breakdown for most common tax type or null
   * @private
   */
  findBreakdownByMostCommonTaxType(breakdownsWithRates) {
    const taxTypeCounts = new Map();
    breakdownsWithRates.forEach(({ taxType }) => {
      if (taxType) {
        taxTypeCounts.set(taxType, (taxTypeCounts.get(taxType) || 0) + 1);
      }
    });
    
    if (taxTypeCounts.size === 0) {
      return null;
    }
    
    let mostCommonTaxType = null;
    let maxCount = 0;
    for (const [taxType, count] of taxTypeCounts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        mostCommonTaxType = taxType;
      }
    }
    
    const result = breakdownsWithRates.find(({ taxType }) => taxType === mostCommonTaxType);
    return result ? result.breakdown : null;
  }

  /**
   * Combine shipping costs from multiple calculations for the same shippingKey
   * @param {Object} existing - Existing calculation data
   * @param {Object} calculation - New calculation to combine
   */
  combineShippingCosts(existing, calculation) {
    // Process shipping_cost (combine or assign)
    this.processShippingCost(existing, calculation);
    
    // Combine general tax_breakdown (independent of shipping_cost)
    this.combineTaxBreakdowns(existing, calculation);
  }

  /**
   * Process shipping_cost from calculation into existing calculation
   * @param {Object} existing - Existing calculation data
   * @param {Object} calculation - New calculation to process
   * @private
   */
  processShippingCost(existing, calculation) {
    // Early return if calculation has no shipping_cost
    if (!calculation.shipping_cost) {
      return;
    }
    
    // If existing has no shipping_cost, assign directly from calculation
    if (!existing.calculation.shipping_cost) {
      existing.calculation.shipping_cost = calculation.shipping_cost;
      return;
    }
    
    // Both have shipping_cost: combine amounts
    existing.calculation.shipping_cost.amount = 
      (existing.calculation.shipping_cost.amount || 0) + 
      (calculation.shipping_cost.amount || 0);
    existing.calculation.shipping_cost.amount_tax = 
      (existing.calculation.shipping_cost.amount_tax || 0) + 
      (calculation.shipping_cost.amount_tax || 0);
    
    // Combine tax_breakdown arrays from shipping_cost if both exist
    if (calculation.shipping_cost.tax_breakdown && existing.calculation.shipping_cost.tax_breakdown) {
      existing.calculation.shipping_cost.tax_breakdown = this.combineArrays(
        existing.calculation.shipping_cost.tax_breakdown,
        calculation.shipping_cost.tax_breakdown
      );
    }
  }

  /**
   * Combine general tax_breakdown arrays from calculation into existing calculation
   * Merges tax_breakdown arrays when both calculation and existing have them.
   * This is independent of shipping_cost processing and always executes.
   * @param {Object} existing - Existing calculation data
   * @param {Object} calculation - New calculation with tax_breakdown to combine
   * @private
   */
  combineTaxBreakdowns(existing, calculation) {
    if (calculation.tax_breakdown && existing.calculation.tax_breakdown) {
      existing.calculation.tax_breakdown = this.combineArrays(
        existing.calculation.tax_breakdown,
        calculation.tax_breakdown
      );
    }
  }

  /**
   * Combine two arrays into a single array, handling null/undefined values
   * @param {Array} array1 - First array to combine (can be null/undefined)
   * @param {Array} array2 - Second array to combine (can be null/undefined)
   * @returns {Array} Combined array containing all elements from both arrays
   * @private
   */
  combineArrays(array1, array2) {
    return [
      ...(array1 || []),
      ...(array2 || [])
    ];
  }

  /**
   * Create a shipping tax action with tax = 0
   * @param {string} shippingKey - Shipping method key
   * @param {Object} calculation - Calculation object (for currency/country)
   * @param {Object} cart - Cart object (for fallback values)
   * @param {number} shippingAmount - Shipping amount (if available, otherwise defaults to 0)
   * @returns {Object} Shipping tax action
   */
  createZeroTaxShippingAction(shippingKey, calculation = null, cart = null, shippingAmount = 0) {
    // If shippingAmount not provided, try to get it from calculation or cart
    if (shippingAmount === 0) {
      if (calculation?.shipping_cost?.amount) {
        shippingAmount = calculation.shipping_cost.amount;
      } else if (cart?.shipping) {
        // Try to find shipping amount from cart shipping methods
        const shippingMethod = Array.isArray(cart.shipping) 
          ? cart.shipping.find(s => s.shippingKey === shippingKey)
          : cart.shipping;
        if (shippingMethod?.shippingInfo?.price?.centAmount) {
          shippingAmount = shippingMethod.shippingInfo.price.centAmount;
        } else if (cart.shippingInfo?.price?.centAmount) {
          shippingAmount = cart.shippingInfo.price.centAmount;
        }
      }
    }
    
    return {
      action: "setShippingMethodTaxAmount",
      shippingKey: shippingKey,
      externalTaxAmount: {
        totalGross: {
          currencyCode: calculation?.currency?.toUpperCase() || cart?.totalPrice?.currencyCode || 'USD',
          centAmount: shippingAmount
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
      this.mapFromRequests(calculations, requests, calculationByShippingKey, shippingInfoByKey);
    } else {
      logger.warn('No requests provided, mapping calculations to shippingInfoGroups by index (may be inaccurate)');
      this.mapFromShippingInfoGroups(calculations, shippingInfoGroups, calculationByShippingKey);
    }
    
    return calculationByShippingKey;
  }

  /**
   * Process a calculation and add or combine it in the calculations map by shippingKey
   * @param {Object} calculation - The Stripe calculation to process
   * @param {string} shippingKey - The shipping method key
   * @param {Map} calculationByShippingKey - The map where calculations are stored by shippingKey
   * @param {Object} shippingInfo - Shipping information object (can be null/undefined)
   * @private
   */
  processCalculationMapping(calculation, shippingKey, calculationByShippingKey, shippingInfo) {
    if (calculationByShippingKey.has(shippingKey)) {
      // If shippingKey already exists, combine shipping costs
      this.combineShippingCosts(calculationByShippingKey.get(shippingKey), calculation);
    } else {
      // If shippingKey doesn't exist, create new entry
      calculationByShippingKey.set(shippingKey, {
        calculation: { ...calculation },
        shippingInfo: shippingInfo
      });
    }
  }

  /**
   * Map calculations from requests array using shippingKey from each request
   * @param {Array} calculations - Array of Stripe calculations
   * @param {Array} requests - Array of Stripe requests (each with shippingKey property)
   * @param {Map} calculationByShippingKey - Map where results are stored
   * @param {Map} shippingInfoByKey - Map of shippingInfo objects by shippingKey
   * @private
   */
  mapFromRequests(calculations, requests, calculationByShippingKey, shippingInfoByKey) {
    for (let i = 0; i < Math.min(calculations.length, requests.length); i++) {
      const request = requests[i];
      const calculation = calculations[i];
      
      // Validate that we have both shippingKey and calculation
      if (request?.shippingKey && calculation) {
        const shippingKey = request.shippingKey;
        const shippingInfo = shippingInfoByKey.get(shippingKey);
        
        // Use common processing function
        this.processCalculationMapping(
          calculation,
          shippingKey,
          calculationByShippingKey,
          shippingInfo
        );
      }
    }
  }

  /**
   * Map calculations from shippingInfoGroups array using shippingKey from each group
   * @param {Array} calculations - Array of Stripe calculations
   * @param {Array} shippingInfoGroups - Array of shipping info groups (each with shippingKey property)
   * @param {Map} calculationByShippingKey - Map where results are stored
   * @private
   */
  mapFromShippingInfoGroups(calculations, shippingInfoGroups, calculationByShippingKey) {
    for (let i = 0; i < Math.min(calculations.length, shippingInfoGroups.length); i++) {
      const calculation = calculations[i];
      const shippingInfo = shippingInfoGroups[i];
      
      // Validate that we have both shippingKey and calculation
      if (shippingInfo?.shippingKey && calculation) {
        const shippingKey = shippingInfo.shippingKey;
        
        // Use common processing function
        // In this case, shippingInfo comes directly from the array
        this.processCalculationMapping(
          calculation,
          shippingKey,
          calculationByShippingKey,
          shippingInfo
        );
      }
    }
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
        
        const shippingAmount = calculation.shipping_cost?.amount || 0;
        const shippingTaxAmount = calculation.shipping_cost?.amount_tax || 0;
        
        if (!calculation.shipping_cost || shippingTaxAmount <= 0) {
          shippingActions.push(this.createZeroTaxShippingAction(shippingKey, calculation, cart, shippingAmount));
          continue;
        }
        
        const taxBreakdown = this.findOrCreateShippingTaxBreakdown(
          calculation, 
          shippingAmount, 
          shippingTaxAmount
        );
        
        if (!taxBreakdown) {
          logger.warn(`No tax breakdown found for shipping method ${shippingKey}, creating action with tax = 0`);
          shippingActions.push(this.createZeroTaxShippingAction(shippingKey, calculation, cart, shippingAmount));
          continue;
        }
        
        const taxRateDetails = taxBreakdown.tax_rate_details;
        
        shippingActions.push({
          action: "setShippingMethodTaxAmount",
          shippingKey: shippingKey,
          externalTaxAmount: {
            totalGross: {
              currencyCode: calculation.currency?.toUpperCase() || cart?.totalPrice?.currencyCode || 'USD',
              centAmount: shippingAmount + shippingTaxAmount
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
        // Try to get shipping amount from cart
        let shippingAmount = 0;
        if (cart?.shipping) {
          const shippingMethod = Array.isArray(cart.shipping) 
            ? cart.shipping.find(s => s.shippingKey === shippingKey)
            : cart.shipping;
          if (shippingMethod?.shippingInfo?.price?.centAmount) {
            shippingAmount = shippingMethod.shippingInfo.price.centAmount;
          }
        }
        shippingActions.push(this.createZeroTaxShippingAction(shippingKey, null, cart, shippingAmount));
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
    const shippingAmount = calculation.shipping_cost?.amount || 0;
    const shippingTaxAmount = calculation.shipping_cost?.amount_tax || 0;
    
    if (!calculation.shipping_cost || shippingTaxAmount <= 0) {
      return {
        action: "setShippingMethodTaxAmount",
        externalTaxAmount: {
          totalGross: {
            currencyCode: calculation.currency?.toUpperCase(),
            centAmount: shippingAmount
          },
          taxRate: {
            name: 'no_shipping_tax',
            amount: 0,
            country: calculation.tax_breakdown?.[0]?.tax_rate_details?.country || 'US'
          }
        }
      };
    }

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
          centAmount: shippingAmount + shippingTaxAmount
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
    
    // Precompute tax rates once
    const breakdownsWithRates = taxBreakdowns
      .map(breakdown => {
        const percentageDecimal = breakdown.tax_rate_details?.percentage_decimal;
        if (!percentageDecimal) return null;
        return {
          breakdown,
          taxRate: parseFloat(percentageDecimal) / 100,
          taxRateDetails: breakdown.tax_rate_details
        };
      })
      .filter(Boolean);
    
    for (const { breakdown, taxRate, taxRateDetails } of breakdownsWithRates) {
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