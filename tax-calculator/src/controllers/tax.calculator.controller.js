import _ from 'lodash';
import {logger} from '../utils/logger.utils.js';
import {
    HTTP_STATUS_BAD_REQUEST,
    HTTP_STATUS_SUCCESS_ACCEPTED,
} from '../constants/http.status.constants.js';

import CustomError from '../errors/custom.error.js';
import taxCodeService from '../services/tax-code.service.js';
import TaxErrorHandlerService from '../services/tax-error-handler.service.js';
import { createStripeClient } from '../clients/stripe.client.js';
import { taxBehaviorService } from '../services/tax-behavior.service.js';
import updateActionService from '../services/update-action.service.js';

export const taxHandler = async (request, response) => {
    let calculation;

    logger.info(`request body: ${JSON.stringify(request.body)}`);
    const cartRequestBody = request.body?.resource?.obj;
    if (_.isEmpty(cartRequestBody)) {
        return response
            .status(HTTP_STATUS_BAD_REQUEST)
            .send(
                new CustomError(
                    HTTP_STATUS_BAD_REQUEST,
                    'Missing cart information in the request body.'
                )
            );
    }
    logger.info(`Cart request body: ${JSON.stringify(cartRequestBody,null,2)}`);

    let taxRequest;
    let actionItems;
    try {
        // Map cart to tax request - may throw TaxCodeNotFoundError
        // This validates that all line items have valid tax codes
        taxRequest = mapCartRequestToTaxRequest(cartRequestBody);

        logger.info(`Tax request to Stripe: ${JSON.stringify(taxRequest,null,2)}`);
        const stripeClient = createStripeClient();

        // Call Stripe Tax API - may throw errors for unsupported countries or missing tax rates
        calculation = await stripeClient.tax.calculations.create(taxRequest);
        logger.info(`Tax calculation from Stripe: ${JSON.stringify(calculation,null,2)}`);
        actionItems = updateActionService.createCartUpdateActionsFromTaxCalculation(calculation);
    } catch (err) {
        return TaxErrorHandlerService.handleTaxCalculationError(err, request, response, cartRequestBody);
    }

    return response.status(HTTP_STATUS_SUCCESS_ACCEPTED).send(
        { actions: actionItems }
    );
};

function mapCartRequestToTaxRequest(cartRequest) {
    let taxRequest = {customer_details: {address: {}}, line_items: []};


    let cartShippingAddress = {};
    if(cartRequest.shippingMode === 'Single'){
        cartShippingAddress = cartRequest.shippingAddress;
    } else {
        cartShippingAddress = cartRequest.shipping[0]?.shippingAddress;
    }

    taxRequest.currency = cartRequest.totalPrice?.currencyCode;
    taxRequest.customer_details.address.country = cartRequest.country;
    taxRequest.customer_details.address.postal_code = cartShippingAddress.postalCode;
    taxRequest.customer_details.address.line1 = cartShippingAddress.streetName;
    taxRequest.customer_details.address.city = cartShippingAddress.city;
    taxRequest.customer_details.address.state = cartShippingAddress.state;
    taxRequest.customer_details.address_source = 'shipping';

    // Determine tax behavior for the cart (applied to all line items)
    const taxBehaviors = taxBehaviorService.determineTaxBehaviorForCart(cartRequest);
    const cartTaxBehavior = taxBehaviors[cartRequest.lineItems[0]?.id]; // All line items have same behavior
    
    logger.info(
        cartTaxBehavior
            ? `Cart tax behavior determined: ${cartTaxBehavior}`
            : 'No cart tax behavior was determined; no behavior will be set on the line items, letting Stripe use its default behavior'
    );
    
    // Log the cart-level decision once for audit purposes
    if (cartRequest.lineItems.length > 0) {
        taxBehaviorService.logBehaviorDecision(cartRequest.lineItems[0], cartTaxBehavior, cartRequest);
    }
    
    for (const cartLineItem of cartRequest.lineItems) {
        const lineItemBehavior = taxBehaviors[cartLineItem.id];
        let lineItemData = {};
        lineItemData.amount = cartLineItem.totalPrice?.centAmount;
        lineItemData.reference = cartLineItem.id;

        // Get tax code dynamically using tax code service
        lineItemData.tax_code = taxCodeService.getTaxCodeForProduct(cartLineItem);

        // Only add tax_behavior if one was determined, otherwise let Stripe use its default behavior
        if (lineItemBehavior) {
            lineItemData.tax_behavior = lineItemBehavior;
        }

        taxRequest.line_items.push(lineItemData);
    }

    taxRequest.shipping_cost = mapShippingInfoToTaxRequest(cartRequest);

    taxRequest.expand = ['line_items']

    return taxRequest;
}

function mapShippingInfoToTaxRequest(cartRequest) {
    let shipping_cost = {};
    
    shipping_cost.tax_behavior = 'exclusive';
    
    if (cartRequest.shippingMode === 'Single') {
        if (cartRequest.shippingInfo) {
            shipping_cost.amount = cartRequest.shippingInfo?.price?.centAmount;
            const taxCode = taxCodeService.getShippingTaxCodeFromShippingInfo(cartRequest.shippingInfo, cartRequest.shippingMode);
            if (taxCode) {
                shipping_cost.tax_code = taxCode;
            }
        }
    } else if (cartRequest.shippingMode === 'Multiple') {
        if (cartRequest.shipping && cartRequest.shipping.length > 0) {
            const {price, taxCode} = taxCodeService.getShippingPriceAndTaxCodeFromShipping(cartRequest.shipping, cartRequest.shippingMode);
            if (price) {
                shipping_cost.amount = price;
                shipping_cost.tax_code = taxCode;
            }
        }
    }
    
    return shipping_cost;
}