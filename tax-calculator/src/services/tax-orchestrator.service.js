import { logger } from '../utils/logger.utils.js';
import { createStripeClient } from '../clients/stripe.client.js';
import shipFromService from './ship-from.service.js';
import ShipFromNotFoundError from '../errors/shipFromNotFoundError.js';
import { taxBehaviorService } from './tax-behavior.service.js';
import categoryService from './category.service.js';
import taxCodeService from './tax-code.service.js';
import updateActionService from './update-action.service.js';

/**
 * Tax Orchestrator Service
 * 
 * Orchestrates the complete tax calculation flow:
 * 1. Determine tax behavior for cart (applied to all line items)
 * 2. Get categories for products
 * 3. Group line items by ship-from address
 * 4. Create separate requests by shippingKey
 * 5. Execute tax calculations in parallel
 * 6. Combine results and create update actions for cart and line items
 * 7. Return the update actions
 */
class TaxOrchestratorService {

  /**
   * Main orchestration method
   * @param {Object} cart - commercetools cart object
   * @returns {Promise<Object>}201 response object with update actions
   */
  async orchestrateTaxCalculation(cart) {
    const startTime = Date.now();
    
    try {
      logger.info('Starting tax orchestration', {
        cartId: cart.id,
        shippingMode: cart.shippingMode,
        lineItemsCount: cart.lineItems?.length || 0
      });

      // STEP 1: Determine tax behavior for cart (applied to all line items)
      const taxBehaviors = taxBehaviorService.determineTaxBehaviorForCart(cart);
      const cartTaxBehavior = taxBehaviors[cart.lineItems[0]?.id]; // All line items have same behavior
      
      logger.info(
        cartTaxBehavior
          ? `Cart tax behavior determined: ${cartTaxBehavior}`
          : 'No cart tax behavior was determined; no behavior will be set on the line items, letting Stripe use its default behavior'
      );
      
      // Log the cart-level decision once for audit purposes
      if (cart.lineItems.length > 0) {
        taxBehaviorService.logBehaviorDecision(cart.lineItems[0], cartTaxBehavior, cart);
      }

      // STEP 2: Get categories for products
      const productIds = cart.lineItems
        .map(item => item.productId)
        .filter(Boolean);

      const categoriesMap = await categoryService.getCategoriesForProducts(
        productIds,
        {
          staged: false,
          locale: cart.locale || undefined,
          useCache: true
        }
      );

      // STEP 3: Group line items by ship-from address
      const shipFromGroups = await this.groupLineItemsByShipFrom(cart);
      
      logger.info('Ship-from groups created', {
        groupsCount: shipFromGroups.length,
        groups: shipFromGroups.map(g => ({
          address: g.shipFromAddress,
          source: g.source,
          lineItemsCount: g.lineItems.length,
          hasShipFrom: !!g.shipFromAddress
        }))
      });

      // STEP 4: For each group, create separate requests by shippingKey
      const requests = [];
      const shippingInfoGroups = [];
      
      for (const group of shipFromGroups) {
        // Creates one request per shipping method (by shippingKey) for precision
        const groupRequests = await this.createRequestsForGroup(group, cart, taxBehaviors, categoriesMap);
        
        // Track shipping info for result combination
        if (cart.shippingMode === 'Multiple') {
          groupRequests.forEach(req => {
            shippingInfoGroups.push({
              shippingKey: req.shippingKey, // Track which shipping method this is for
              taxCode: req.shipping_cost?.tax_code || null,
              lineItems: req.line_items.map(li => li.reference),
              hasShippingCost: !!req.shipping_cost
            });
          });
        }
        requests.push(...groupRequests);
      }
      
      logger.info('Stripe requests prepared', {
        requestsCount: requests.length,
        shippingMethodsCount: shippingInfoGroups.length
      });

      // STEP 5: Execute Stripe calculations in parallel
      const stripeClient = createStripeClient();
      const calculations = await this.executeTaxCalculations(requests, stripeClient);
      
      const calculationIds = calculations.map(calc => calc.id);
      logger.info('Tax calculations completed', {
        calculationsCount: calculations.length,
        calculationIds: calculationIds,
        duration: Date.now() - startTime
      });

      // STEP 6: Combine results and create update actions
      const actionItems = updateActionService.createCartUpdateActionsFromMultipleCalculations(
        calculations,
        shippingInfoGroups,
        requests,
        cart
      );
      
      logger.info('Orchestration completed successfully', {
        actionsCount: actionItems.length,
        totalDuration: Date.now() - startTime,
        calculationReferences: calculationIds
      });

      return {
        actions: actionItems
      };

    } catch (error) {
      logger.error('Tax orchestration failed', {
        error: error.message,
        duration: Date.now() - startTime
      });
      throw error;
    }
  }

  /**
   * Group line items by ship-from address
   * @param {Object} cart - commercetools cart
   * @returns {Promise<Array>} Array of ship-from groups
   */
  async groupLineItemsByShipFrom(cart) {
    const groups = new Map();
    
    // Resolve all ship-from addresses in parallel
    const shipFromResults = await shipFromService.resolveAllShipFromAddresses(cart.lineItems);
    
    for (let i = 0; i < cart.lineItems.length; i++) {
      const lineItem = cart.lineItems[i];
      const shipFromInfo = shipFromResults[i];
      
      // Create unique key from address
      const addressKey = this.createAddressKey(shipFromInfo.address);
      
      if (!groups.has(addressKey)) {
        groups.set(addressKey, {
          shipFromAddress: shipFromInfo.address,
          source: shipFromInfo.source,
          lineItems: []
        });
      }
      
      groups.get(addressKey).lineItems.push(lineItem);
    }
    
    const groupsArray = Array.from(groups.values());
    
    // Validate ship-from requirement (if enabled)
    if (process.env.SHIP_FROM_REQUIRED === 'true') {
      this.validateShipFromGroups(groupsArray, cart);
    }
    
    return groupsArray;
  }

  /**
   * Create Stripe requests for a ship-from group
   * Separates by shippingKey for maximum precision and traceability
   * @param {Object} group - Ship-from group object
   * @param {Object} cart - Original cart
   * @param {Object} taxBehaviors - Tax behavior map for line items
   * @param {Object} categoriesMap - Map of categories for products
   * @returns {Promise<Array>} Array of Stripe request objects
   */
  async createRequestsForGroup(group, cart, taxBehaviors, categoriesMap) {
    // Single mode: one request
    if (cart.shippingMode === 'Single') {
      return [await this.createSingleRequestForGroup(group, cart, taxBehaviors, categoriesMap)];
    }
    
    // Multiple mode: separate request per shipping method (by shippingKey)
    // This provides exact precision and avoids proportional distribution complexity
    return await this.createSeparatedRequestsByShippingKey(group, cart, taxBehaviors, categoriesMap);
  }

  /**
   * Create a single request for a group (no shipping tax code separation)
   * @param {Object} group - Ship-from group
   * @param {Object} cart - Original cart
   * @param {Object} taxBehaviors - Tax behavior map for line items
   * @param {Object} categoriesMap - Map of categories for products
   * @returns {Object} Stripe request object
   */
  async createSingleRequestForGroup(group, cart, taxBehaviors, categoriesMap) {
    const request = {
      customer_details: {
        address: this.extractCustomerAddress(cart),
        address_source: 'shipping'
      },
      line_items: [],
      currency: cart.totalPrice.currencyCode,
      expand: ['line_items']
    };
    
    // Only include ship_from_details if address is available
    // For digital products or optional ship-from, omit this field
    if (group.shipFromAddress) {
      request.ship_from_details = {
        address: group.shipFromAddress
      };
    }
    
    // Add line items
    for (const lineItem of group.lineItems) {
      const lineItemData = {
        amount: lineItem.totalPrice?.centAmount,
        metadata: {
          cartId: cart.id,
          customerId: cart.customerId,
          anonymousId: cart.anonymousId,
          shippingKey: cart.shippingKey
        },
        reference: lineItem.id,
        tax_code: taxCodeService.getTaxCodeForProduct(lineItem, categoriesMap.get(lineItem.productId) || []),
        quantity: lineItem.quantity
      };
      
      // Add tax_behavior if determined
      const lineItemBehavior = taxBehaviors[lineItem.id];
      if (lineItemBehavior) {
        lineItemData.tax_behavior = lineItemBehavior;
      }
      
      request.line_items.push(lineItemData);
    }
    
    // Add shipping cost
    const shippingCost = await this.getShippingCostForGroup(cart);
    if (shippingCost?.amount) {
      request.shipping_cost = {
        amount: shippingCost.amount,
        tax_code: shippingCost.tax_code,
        tax_behavior: 'exclusive'
      };
    }
    
    return request;
  }

  /**
   * Create separate requests by shippingKey (one per shipping method)
   * Provides exact precision and direct mapping to Commercetools shipping methods
   * @param {Object} group - Ship-from group
   * @param {Object} cart - Original cart
   * @param {Object} taxBehaviors - Tax behavior map for line items
   * @param {Object} categoriesMap - Map of categories for products
   * @returns {Promise<Array>} Array of Stripe request objects
   */
  async createSeparatedRequestsByShippingKey(group, cart, taxBehaviors, categoriesMap) {
    const requests = [];
    
    // Fetch all shipping costs in parallel
    const shippingCostPromises = cart.shipping.map(shipping => 
      this.getShippingCostForShippingMethod(shipping).then(cost => ({ shipping, cost }))
    );
    const shippingCostsResults = await Promise.all(shippingCostPromises);
    const shippingCostsMap = new Map(
      shippingCostsResults.map(({ shipping, cost }) => [shipping.shippingKey, cost])
    );
    
    // Create one request per shipping method
    for (const shipping of cart.shipping) {
      const request = {
        customer_details: {
          address: this.extractCustomerAddress(cart, shipping),
          address_source: 'shipping'
        },
        line_items: [],
        currency: cart.totalPrice.currencyCode,
        expand: ['line_items'],
        shippingKey: shipping.shippingKey // Store for tracking
      };
      
      // Only include ship_from_details if address is available
      // For digital products or optional ship-from, omit this field
      if (group.shipFromAddress) {
        request.ship_from_details = {
          address: group.shipFromAddress
        };
      }
      
      // Add line items that target this specific shipping method
      for (const lineItem of group.lineItems) {
        const lineItemData = this.buildLineItemForShippingMethod(
          cart,
          lineItem,
          shipping.shippingKey,
          taxBehaviors,
          categoriesMap
        );
        
        if (lineItemData && lineItemData.amount > 0) {
          request.line_items.push(lineItemData);
        }
      }
      
      // Add shipping cost for this specific shipping method (from pre-fetched map)
      const shippingCost = shippingCostsMap.get(shipping.shippingKey);
      if (shippingCost?.amount) {
        request.shipping_cost = {
          amount: shippingCost.amount,
          tax_code: shippingCost.tax_code,
          tax_behavior: 'exclusive'
        };
      }
      
      // Only add request if it has line items or shipping cost
      // Avoid creating empty requests to Stripe
      if (request.line_items.length > 0 || request.shipping_cost) {
        requests.push(request);
      } else {
        logger.debug(`Skipping empty request for shipping method ${shipping.shippingKey}`, {
          shippingKey: shipping.shippingKey,
          groupLineItemsCount: group.lineItems.length
        });
      }
    }
    
    return requests;
  }

  /**
   * Build line item data for a specific shipping method
   * @param {Object} cart - Original cart
   * @param {Object} lineItem - Line item
   * @param {string} shippingKey - Target shipping method key
   * @param {Object} taxBehaviors - Tax behavior map
   * @param {Object} categoriesMap - Map of categories for products
   * @returns {Object|null} Line item data or null if not applicable
   */
  buildLineItemForShippingMethod(cart, lineItem, shippingKey, taxBehaviors, categoriesMap) {
    const targets = lineItem.shippingDetails?.targets || [];
    
    // Find target quantity for this shipping method
    const target = targets.find(t => t.shippingMethodKey === shippingKey);
    
    if (!target || target.quantity === 0) {
      return null;
    }
    
    const totalQuantity = lineItem.quantity;
    const totalAmount = lineItem.totalPrice?.centAmount || 0;
    const proportionalAmount = Math.round((totalAmount * target.quantity) / totalQuantity);
    
    const lineItemData = {
      amount: proportionalAmount,
      metadata: {
        cartId: cart.id,
        customerId: cart.customerId,
        anonymousId: cart.anonymousId,
        shippingKey
      },
      reference: lineItem.id,
      tax_code: taxCodeService.getTaxCodeForProduct(lineItem, categoriesMap.get(lineItem.productId) || []),
      quantity: target.quantity
    };
    
    // Add tax_behavior if determined
    const lineItemBehavior = taxBehaviors[lineItem.id];
    if (lineItemBehavior) {
      lineItemData.tax_behavior = lineItemBehavior;
    }
    
    return lineItemData;
  }

  /**
   * Get shipping cost for a ship-from group (used in Single mode)
   * In Single mode, there's only one shipping method for the entire cart,
   * so we return the total shipping cost directly from cart.shippingInfo
   * @param {Object} cart - Original cart
   * @returns {Object|null} Shipping cost with tax code, or null if no shipping cost
   */
  async getShippingCostForGroup(cart) {
    if (!cart.shippingInfo?.price?.centAmount) {
      return null;
    }
    
    const taxCode = await taxCodeService.getShippingTaxCodeFromShippingInfo(cart.shippingInfo);
    
    return {
      amount: cart.shippingInfo.price.centAmount,
      tax_code: taxCode
    };
  }

  /**
   * Get shipping cost for a specific shipping method
   * @param {Object} shipping - Shipping object from cart
   * @returns {Object|null} Shipping cost with tax code
   */
  async getShippingCostForShippingMethod(shipping) {
    if (!shipping.shippingInfo?.price?.centAmount) {
      return null;
    }
    
    const taxCode = await taxCodeService.getShippingTaxCodeFromShippingInfo(shipping.shippingInfo);
    
    return {
      amount: shipping.shippingInfo.price.centAmount,
      tax_code: taxCode
    };
  }

  /**
   * Extract customer address from cart
   * @param {Object} cart - commercetools cart
   * @returns {Object} Stripe-formatted customer address
   */
  extractCustomerAddress(cart, shipping = null) {
    let shippingAddress = {};
    
    if (cart.shippingMode === 'Single') {
      shippingAddress = cart.shippingAddress || {};
    } else if (cart.shippingMode === 'Multiple') {
      // Use the specific shipping address if provided, otherwise fall back to first
      if (shipping?.shippingAddress) {
        shippingAddress = shipping.shippingAddress;
      } else if (cart.shipping?.length > 0) {
        shippingAddress = cart.shipping[0]?.shippingAddress || {};
      }
    }
    
    return {
      country: cart.country,
      state: shippingAddress.state,
      city: shippingAddress.city,
      postal_code: shippingAddress.postalCode,
      line1: shippingAddress.streetName || shippingAddress.line1,
      line2: shippingAddress.streetNumber || shippingAddress.line2
    };
  }

  /**
   * Execute tax calculations in parallel
   * @param {Array} requests - Array of Stripe request objects
   * @param {Object} stripeClient - Stripe client
   * @returns {Promise<Array>} Array of Stripe calculation responses
   */
  async executeTaxCalculations(requests, stripeClient) {
    logger.info(`Executing ${requests.length} tax calculations in parallel`);
    logger.info('Requests', { requests: requests });
    
    const calculations = await Promise.allSettled(
      requests.map((request, index) => {
        logger.debug(`Tax calculation ${index + 1}/${requests.length}`, {
          line_items_count: request.line_items.length,
          ship_from: request.ship_from_details?.address || null
        });
        
        // Remove shippingKey before sending to Stripe (it's only for internal tracking)
        const stripeRequest = { ...request };
        delete stripeRequest.shippingKey;
        
        return stripeClient.tax.calculations.create(stripeRequest);
      })
    );
    
    const successful = calculations.filter(r => r.status === 'fulfilled').map(r => r.value);
    const failed = calculations.filter(r => r.status === 'rejected');
    
    if (failed.length > 0) {
      logger.warn(`${failed.length} tax calculations failed`, {
        errors: failed.map(f => f.reason?.message)
      });
    }
    
    if (successful.length === 0) {
      throw new Error('All tax calculations failed');
    }
    
    const calculationIds = successful.map(calc => calc.id);
    logger.info('Tax calculations completed successfully', {
      successfulCount: successful.length,
      failedCount: failed.length,
      calculationIds: calculationIds,
      successful: successful
    });
    
    return successful;
  }

  /**
   * Create unique key from address
   * @param {Object} address - Address object
   * @returns {string} Unique address key
   */
  createAddressKey(address) {
    // Handle null/undefined address (for digital products or optional ship-from)
    if (!address) {
      return 'no_ship_from';
    }
    
    return JSON.stringify({
      country: address.country,
      state: address.state,
      city: address.city,
      postal_code: address.postal_code
    });
  }

  /**
   * Validate that all groups have valid ship-from addresses
   * @param {Array} groups - Ship-from groups
   * @param {Object} cart - Original cart
   * @throws {ShipFromNotFoundError} If validation fails
   */
  validateShipFromGroups(groups, cart) {
    const groupsWithoutAddress = groups.filter(g => !g.shipFromAddress?.country);
    
    if (groupsWithoutAddress.length > 0) {
      throw new ShipFromNotFoundError(
        'Ship-from address could not be determined for some line items',
        cart
      );
    }
  }
}

// Singleton instance
const taxOrchestratorService = new TaxOrchestratorService();

export default taxOrchestratorService;
export { TaxOrchestratorService };