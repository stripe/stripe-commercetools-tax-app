import { logger } from '../utils/logger.utils.js';
import { createStripeClient } from '../clients/stripe.client.js';
import shipFromService from './ship-from.service.js';
import ShipFromNotFoundError from '../errors/shipFromNotFoundError.js';
import InvalidTaxDestinationError from '../errors/invalidTaxDestination.error.js';
import { taxBehaviorService } from './tax-behavior.service.js';
import categoryService from './category.service.js';
import taxCodeService from './tax-code.service.js';
import updateActionService from './update-action.service.js';
import { CART_TAX_FIELD_NAMES } from '../connectors/customTypes.js';

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
   * @returns {Promise<Object>} 201 response object with update actions
   */
  async orchestrateTaxCalculation(cart) {
    const startTime = Date.now();
    
    try {
      logger.info('Starting tax orchestration', {
        cartId: cart.id,
        shippingMode: cart.shippingMode,
        lineItemsCount: cart.lineItems?.length || 0
      });

      // STEP 1: Determine tax behavior from the delivery destination, not from cart.country
      const destinationCountry = this.resolveDestinationCountry(cart);
      const taxBehaviors = taxBehaviorService.determineTaxBehaviorForCart(cart, destinationCountry);
      const cartTaxBehavior = taxBehaviors[cart.lineItems[0]?.id]; // All line items have same behavior

      logger.info(
        cartTaxBehavior
          ? `Cart tax behavior determined: ${cartTaxBehavior}`
          : 'No cart tax behavior was determined; no behavior will be set on the line items, letting Stripe use its default behavior'
      );

      // Log the cart-level decision once for audit purposes
      if (cart.lineItems.length > 0) {
        taxBehaviorService.logBehaviorDecision(cart.lineItems[0], cartTaxBehavior, cart, destinationCountry);
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
      
      logger.debug('Ship-from groups created', {
        groupsCount: shipFromGroups.length,
        sources: shipFromGroups.map(g => g.source)
      });

      // STEP 4: For each group, create separate requests by shippingKey
      const { requests, shippingInfoGroups } = await this.createRequestsAndTrackShippingInfo(
        shipFromGroups,
        cart,
        taxBehaviors,
        categoriesMap
      );
      
      logger.debug('Stripe requests prepared', {
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
   * Create Stripe requests and track shipping info groups
   * @param {Array} shipFromGroups - Ship-from groups
   * @param {Object} cart - Original cart
   * @param {Object} taxBehaviors - Tax behavior map for line items
   * @param {Object} categoriesMap - Map of categories for products
   * @returns {Promise<Object>} Object with { requests, shippingInfoGroups }
   * @private
   */
  async createRequestsAndTrackShippingInfo(shipFromGroups, cart, taxBehaviors, categoriesMap) {
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
    
    return { requests, shippingInfoGroups };
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
   * @returns {Promise<Object>} Stripe request object
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
        tax_code: shippingCost.tax_code
      };
      // Shipping follows the same resolved tax behavior as line items (country mapping,
      // then merchant default, then Stripe's own default if neither is configured) —
      // see business-rules/tax-calculation.md Rule 6 (corrected 2026-07-28; previously
      // hardcoded to 'exclusive' regardless of TAX_BEHAVIOR_COUNTRY_MAPPING).
      const shippingBehavior = taxBehaviors[group.lineItems[0]?.id];
      if (shippingBehavior) {
        request.shipping_cost.tax_behavior = shippingBehavior;
      }
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
    const shippingCostsMap = await this.fetchShippingCostsMap(cart);
    const requests = [];
    const cartDestination = this.resolveDestinationCountry(cart);

    // Create one request per shipping method
    for (const shipping of cart.shipping) {
      const request = this.buildRequestForShippingMethod(shipping, group, cart);

      // A Multiple-mode cart can deliver to several countries, and the tax behavior follows the
      // destination. Only recompute when this shipping method goes somewhere else than the cart
      // as a whole, so the ordinary single-destination cart keeps one resolution.
      const destination = this.resolveDestinationCountry(cart, shipping);
      const behaviorsForDestination = destination === cartDestination
        ? taxBehaviors
        : taxBehaviorService.determineTaxBehaviorForCart(cart, destination);

      this.populateRequestWithLineItems(
        request, group, shipping, cart, behaviorsForDestination, categoriesMap, shippingCostsMap
      );
      
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
   * Fetch all shipping costs in parallel and return as a Map
   * @param {Object} cart - Original cart
   * @returns {Promise<Map>} Map where key=shippingKey, value=shipping cost object
   * @private
   */
  async fetchShippingCostsMap(cart) {
    const shippingCostPromises = cart.shipping.map(shipping => 
      this.getShippingCostForShippingMethod(shipping).then(cost => ({ shipping, cost }))
    );
    const shippingCostsResults = await Promise.all(shippingCostPromises);
    return new Map(
      shippingCostsResults.map(({ shipping, cost }) => [shipping.shippingKey, cost])
    );
  }

  /**
   * Build base request structure for a shipping method
   * @param {Object} shipping - Shipping method object
   * @param {Object} group - Ship-from group
   * @param {Object} cart - Original cart
   * @returns {Object} Base Stripe request object
   * @private
   */
  buildRequestForShippingMethod(shipping, group, cart) {
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
    
    return request;
  }

  /**
   * Populate request with line items and shipping cost
   * @param {Object} request - Stripe request object to populate
   * @param {Object} group - Ship-from group
   * @param {Object} shipping - Shipping method object
   * @param {Object} cart - Original cart
   * @param {Object} taxBehaviors - Tax behavior map for line items
   * @param {Object} categoriesMap - Map of categories for products
   * @param {Map} shippingCostsMap - Map of shipping costs by shippingKey
   * @private
   */
  populateRequestWithLineItems(request, group, shipping, cart, taxBehaviors, categoriesMap, shippingCostsMap) {
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
        tax_code: shippingCost.tax_code
      };
      // Shipping follows the same resolved tax behavior as line items — see
      // business-rules/tax-calculation.md Rule 6 (corrected 2026-07-28).
      const shippingBehavior = taxBehaviors[group.lineItems[0]?.id];
      if (shippingBehavior) {
        request.shipping_cost.tax_behavior = shippingBehavior;
      }
    }
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
   * @returns {Promise<Object|null>} Shipping cost with tax code, or null if no shipping cost
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
   * @returns {Promise<Object|null>} Shipping cost with tax code
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
   * Extract the tax destination address from the cart.
   *
   * Stripe treats `customer_details.address` as the transaction destination, so every field of
   * it — the country included — comes from the delivery address. `cart.country` selects prices
   * in commercetools and is shopper-controlled; it is not a statement about where the order is
   * delivered, and using it here let a shopper move the sale to another jurisdiction while the
   * goods still went to the original address (SB3-218).
   *
   * `cart.country` survives only as the fallback for a cart that has no delivery address at all,
   * so a cart still calculates before the shopper has entered one.
   *
   * @param {Object} cart - commercetools cart
   * @param {Object} [shipping] - The shipping method being priced, in Multiple shipping mode
   * @returns {Object} Stripe-formatted customer address
   * @throws {InvalidTaxDestinationError} If a delivery address is present but carries no country
   */
  extractCustomerAddress(cart, shipping = null) {
    let shippingAddress = {};
    let shippingKey = null;

    if (cart.shippingMode === 'Single') {
      shippingAddress = cart.shippingAddress || {};
    } else if (cart.shippingMode === 'Multiple') {
      // Use the specific shipping address if provided, otherwise fall back to first
      if (shipping?.shippingAddress) {
        shippingAddress = shipping.shippingAddress;
        shippingKey = shipping.shippingKey ?? null;
      } else if (cart.shipping?.length > 0) {
        shippingAddress = cart.shipping[0]?.shippingAddress || {};
        shippingKey = cart.shipping[0]?.shippingKey ?? null;
      }
    }

    this.assertDestinationIsUsable(shippingAddress, shippingKey);

    return {
      // No delivery address at all → fall back to cart.country. Never mix the two: a delivery
      // address that exists always carries its own country (commercetools requires it), and
      // assertDestinationIsUsable has already rejected any that does not.
      country: shippingAddress.country || cart.country,
      state: shippingAddress.state,
      city: shippingAddress.city,
      postal_code: shippingAddress.postalCode,
      line1: shippingAddress.streetName || shippingAddress.line1,
      line2: shippingAddress.streetNumber || shippingAddress.line2
    };
  }

  /**
   * The country the order is delivered to — the country that decides the tax treatment.
   *
   * Reads through extractCustomerAddress so there is exactly one definition of "the destination"
   * in this service: whatever Stripe is told the destination is, is what the tax behavior is
   * resolved from. The two cannot drift apart.
   *
   * @param {Object} cart - commercetools cart
   * @param {Object} [shipping] - The shipping method being priced, in Multiple shipping mode
   * @returns {string|undefined} Destination country code, or undefined if the cart has no address
   */
  resolveDestinationCountry(cart, shipping = null) {
    return this.extractCustomerAddress(cart, shipping).country;
  }

  /**
   * Every country this cart currently delivers to, in the same shape update-action.service.js
   * records alongside a calculation — sorted, comma-separated, deduplicated — so the two can be
   * compared directly when deciding whether a stored calculation may be re-applied.
   *
   * @param {Object} cart - commercetools cart
   * @returns {string} Sorted, comma-separated destination countries
   */
  summariseCartDestinations(cart) {
    const destinations = cart.shippingMode === 'Multiple' && cart.shipping?.length
      ? cart.shipping.map(shipping => this.resolveDestinationCountry(cart, shipping))
      : [this.resolveDestinationCountry(cart)];

    return [...new Set(destinations.filter(Boolean))].sort().join(',');
  }

  /**
   * Reject a delivery address that locates the order without naming its country.
   *
   * commercetools requires `country` on every Address, so this combination cannot arrive through
   * the normal cart API. Completing it from `cart.country` would send Stripe an address that
   * exists in no single jurisdiction — exactly the hybrid destination behind SB3-218 — so the
   * cart update is refused instead.
   *
   * An entirely empty address is not an error: that is a cart that has not collected one yet.
   *
   * @param {Object} shippingAddress - Delivery address as received from commercetools
   * @param {string|null} shippingKey - Shipping method key, in Multiple shipping mode
   * @throws {InvalidTaxDestinationError}
   * @private
   */
  assertDestinationIsUsable(shippingAddress, shippingKey) {
    if (shippingAddress?.country) {
      return;
    }

    const locatesTheOrder = ['city', 'postalCode', 'streetName', 'state', 'line1']
      .some(field => shippingAddress?.[field]);

    if (locatesTheOrder) {
      throw new InvalidTaxDestinationError(shippingAddress, shippingKey);
    }
  }

  /**
   * Execute tax calculations in parallel
   * @param {Array} requests - Array of Stripe request objects
   * @param {Object} stripeClient - Stripe client
   * @returns {Promise<Array>} Array of Stripe calculation responses
   */
  async executeTaxCalculations(requests, stripeClient) {
    logger.info('Executing Stripe tax calculations', {
      requestCount: requests.length,
      requests: requests.map((req, index) => ({
          index,
          shippingKey: req.shippingKey || 'single',
          lineItemsCount: req.line_items?.length || 0,
          hasShippingCost: !!req.shipping_cost,
          shippingAmount: req.shipping_cost?.amount || 0,
          currency: req.currency,
          customerCountry: req.customer_details?.address?.country,
          shipFromCountry: req.ship_from_details?.address?.country || 'not_set'
      }))
    });
    
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
      logger.warn('Some Stripe tax calculations failed', {
          failedCount: failed.length,
          totalRequests: requests.length,
          errors: failed.map((f, index) => ({
              requestIndex: index,
              errorType: f.reason?.type,
              errorCode: f.reason?.code
          }))
      });
  }
    
    if (successful.length === 0) {
      throw new Error('All tax calculations failed');
    }
    
    logger.info('Stripe tax calculations completed', {
      successfulCount: successful.length,
      failedCount: failed.length,
      totalRequests: requests.length,
      calculations: successful.map((calc, index) => ({
          index,
          calculationId: calc.id,
          currency: calc.currency,
          amountTotal: calc.amount_total,
          taxAmountExclusive: calc.tax_amount_exclusive,
          taxAmountInclusive: calc.tax_amount_inclusive,
          lineItemsCount: calc.line_items?.data?.length || 0,
          hasShippingCost: !!calc.shipping_cost,
          shippingTax: calc.shipping_cost?.amount_tax || 0,
          taxBreakdownCount: calc.tax_breakdown?.length || 0
      }))
  });
    
    return successful;
  }

  /**
   * Re-apply an existing Stripe Tax calculation to the cart without creating a new one.
   *
   * Used when CT clears taxedPrice after a cart update (e.g. setShippingAddress) while
   * paymentInfo is already attached — the normal extension guard blocks recalculation,
   * so we retrieve the existing calculation by ID and re-emit the same update actions.
   * The PI already holds the original calculationId via hooks.inputs.tax.calculation,
   * so using retrieve() keeps PI, cart, and order-syncer on the same reference.
   *
   * @param {Object} cart - commercetools cart object (must have custom.fields.connectorStripeTax_calculationReferences)
   * @returns {Promise<Object>} Response object with update actions
   */
  async reapplyExistingCalculation(cart) {
    const startTime = Date.now();
    const calculationId = cart.custom?.fields?.connectorStripeTax_calculationReferences?.[0];
    if (!calculationId) {
      throw new Error(`reapplyExistingCalculation called on cart ${cart.id} with no calculationReferences`);
    }

    // Re-applying trusts a stored calculation without asking Stripe again, so it is only safe
    // while that calculation still belongs to where the order is going. A calculation stored
    // before SB3-218 carries no destination at all and may have been made against a shopper's
    // cart.country; recalculating is how the fix reaches carts that already exist.
    const storedDestinations = cart.custom?.fields?.[CART_TAX_FIELD_NAMES.DESTINATION_COUNTRY];
    const currentDestinations = this.summariseCartDestinations(cart);

    if (!storedDestinations || storedDestinations !== currentDestinations) {
      logger.info('Stored calculation does not match the cart destination — recalculating', {
        cartId: cart.id,
        calculationId,
        storedDestinations: storedDestinations || 'none recorded',
        currentDestinations
      });
      return this.orchestrateTaxCalculation(cart);
    }

    try {
      logger.info('Retrieving existing Stripe Tax calculation for re-apply', {
        cartId: cart.id,
        calculationId
      });

      const stripeClient = createStripeClient();
      const calculation = await stripeClient.tax.calculations.retrieve(calculationId, {
        expand: ['line_items']
      });

      const lineItemActions = updateActionService.createLineItemActionsFromCalculation(
        calculation,
        null
      );

      const shippingTaxAction = cart.shippingMode === 'Single' && cart.shippingInfo
        ? updateActionService.createShippingTaxUpdateAction(calculation)
        : null;

      const cartTotalTaxAction = updateActionService.createCartTotalTaxAction(calculation);

      const actions = [
        ...lineItemActions,
        ...(shippingTaxAction ? [shippingTaxAction] : []),
        ...(cartTotalTaxAction ? [cartTotalTaxAction] : [])
      ];

      logger.info('Tax re-apply completed', {
        cartId: cart.id,
        calculationId,
        actionsCount: actions.length,
        duration: Date.now() - startTime
      });

      return { actions };

    } catch (error) {
      logger.error('Tax re-apply failed', {
        cartId: cart.id,
        calculationId,
        error: error.message,
        duration: Date.now() - startTime
      });
      throw error;
    }
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