import _ from 'lodash';
import stripe from 'stripe';
import {logger} from '../utils/logger.utils.js';
import {
    HTTP_STATUS_BAD_REQUEST,
    HTTP_STATUS_SERVER_ERROR,
    HTTP_STATUS_SUCCESS_ACCEPTED,
} from '../constants/http.status.constants.js';

import CustomError from '../errors/custom.error.js';
import configUtils from '../utils/config.util.js';
import { taxBehaviorService } from '../services/tax-behavior.service.js';

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
    const taxRequest = await mapCartRequestToTaxRequest(cartRequestBody);
    let actionItems;
    try {
        logger.info(`Tax request to Stripe: ${JSON.stringify(taxRequest,null,2)}`);
        const stripeInstance = new stripe(configUtils.readConfiguration().stripeApiToken);
        calculation = await stripeInstance.tax.calculations.create(taxRequest);
        logger.info(`Tax calculation from Stripe2: ${JSON.stringify(calculation,null,2)}`);
        actionItems = await addUpdateCartLineItems(cartRequestBody.id, calculation);
    } catch (err) {
        logger.error(err);
        if (err.statusCode) return response.status(err.statusCode).send(err);
        return response.status(HTTP_STATUS_SERVER_ERROR).send(err);
    }

    return response.status(HTTP_STATUS_SUCCESS_ACCEPTED).send(
        { actions: actionItems }
    );
};

async function addUpdateCartLineItems(cartId, calculation) {
    let actionItems = [];

    const taxRateDetails = calculation.tax_breakdown[0]?.tax_rate_details;
    const calculatedLineItems = calculation.line_items?.data;
    for (const lineItemTaxData of calculatedLineItems) {
        actionItems.push({
            action: "setLineItemTaxAmount",
            lineItemId: lineItemTaxData.reference,
            externalTaxAmount: {
                totalGross: {
                    currencyCode: calculation.currency?.toUpperCase(),
                    centAmount: lineItemTaxData.amount_tax
                },
                taxRate: {
                    name: taxRateDetails?.tax_type,
                    amount: parseFloat(taxRateDetails?.percentage_decimal/100),
                    country: taxRateDetails?.country
                }
            }
        });
    }

    return actionItems;
}

async function mapCartRequestToTaxRequest(cartRequest) {
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

    // Determine tax behavior for each line item using the tax behavior service
    const taxBehaviors = await taxBehaviorService.determineTaxBehaviorForCart(cartRequest);
    logger.info(`Tax behaviors determined: ${JSON.stringify(taxBehaviors)}`);
    
    for (const cartLineItem of cartRequest.lineItems) {
        const lineItemBehavior = taxBehaviors[cartLineItem.id];
        
        // Log the decision for audit purposes
        taxBehaviorService.logBehaviorDecision(cartLineItem, lineItemBehavior, cartRequest);

        let lineItemData = {};
        lineItemData.amount = cartLineItem.totalPrice?.centAmount;
        lineItemData.reference = cartLineItem.id;
        lineItemData.tax_code = "txcd_99999999";

        // Only add tax_behavior if one was determined, otherwise let Stripe use automatic behavior
        if (lineItemBehavior) {
            lineItemData.tax_behavior = lineItemBehavior;
        }

        taxRequest.line_items.push(lineItemData);
    }

    taxRequest.expand = ['line_items']

    return taxRequest;
}
