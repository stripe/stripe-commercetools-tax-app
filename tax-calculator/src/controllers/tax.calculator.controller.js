import _ from 'lodash';
import {logger} from '../utils/logger.utils.js';
import {
    HTTP_STATUS_BAD_REQUEST,
    HTTP_STATUS_SERVER_ERROR,
    HTTP_STATUS_SUCCESS_ACCEPTED,
} from '../constants/http.status.constants.js';

import CustomError from '../errors/custom.error.js';
//import { validateCartAddress } from '../validators/address.validator.js';
import taxCodeService from '../services/tax-code.service.js';
import TaxCodeNotFoundError from '../errors/taxCodeNotFound.error.js';
import TaxCodeShippingNotFoundError from '../errors/taxCodeShippingNotFound.error.js';
import MissingTaxRateForCountry from '../errors/missingTaxRateForCountry.error.js';
import { createStripeClient } from '../clients/stripe.client.js';

const CTP_TYPE_TAX_TXN_KEY = 'stripe-tax';

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
        actionItems = await addUpdateCartLineItems(cartRequestBody.id, calculation);
    } catch (err) {
        // Handle tax code not found errors - return commercetools validation error
        if (err instanceof TaxCodeNotFoundError) {
            logger.error('Tax code not found', {
                productId: err.productId,
                categories: err.categories
            });
            return response.status(HTTP_STATUS_BAD_REQUEST).json({
                errors: [err.toCommerceToolsError()]
            });
        }

        // Handle tax code shipping not found errors - return commercetools validation error
        if (err instanceof TaxCodeShippingNotFoundError) {
            logger.error('Tax code shipping not found', {
                shippingArray: err.shippingArray
            });
            return response.status(HTTP_STATUS_BAD_REQUEST).json({
                errors: [err.toCommerceToolsError()]
            });
        }

        // Handle Stripe API errors related to tax calculation
        if (err.type === 'StripeInvalidRequestError' || err.type === 'StripeAPIError') {
            const country = cartRequestBody.country;
            const state = cartRequestBody.shippingMode === 'Single'
                ? cartRequestBody.shippingAddress?.state
                : cartRequestBody.shipping?.[0]?.shippingAddress?.state;

            // Map Stripe error codes to appropriate responses
            const stripeErrorCode = err.code;

            // Tax calculation errors that indicate missing tax rate or unsupported country
            const taxRateErrors = [
                'taxes_calculation_failed',
                'invalid_tax_location',
                'customer_tax_location_invalid',
                'shipping_address_invalid'
            ];

            if (taxRateErrors.includes(stripeErrorCode)) {
                logger.error('Stripe tax calculation failed - missing tax rate or unsupported country', {
                    stripeErrorCode,
                    stripeErrorType: err.type,
                    stripeErrorMessage: err.message,
                    country,
                    state,
                    correlationId: request.headers['x-correlation-id']
                });

                const missingTaxRateError = MissingTaxRateForCountry.fromStripeError(err, country, state);
                return response.status(HTTP_STATUS_BAD_REQUEST).json({
                    errors: [missingTaxRateError.toCommerceToolsError()]
                });
            }

            // Handle stripe_tax_inactive specifically
            if (stripeErrorCode === 'stripe_tax_inactive') {
                logger.error('Stripe Tax not activated', {
                    stripeErrorMessage: err.message,
                    correlationId: request.headers['x-correlation-id']
                });
                return response.status(HTTP_STATUS_BAD_REQUEST).json({
                    errors: [{
                        code: 'InvalidInput',
                        message: 'Stripe Tax is not activated. Please enable Stripe Tax in your Stripe Dashboard.',
                        extensionExtraInfo: {
                            originalError: 'stripe_tax_inactive',
                            action: 'Enable Stripe Tax at https://dashboard.stripe.com/settings/tax'
                        }
                    }]
                });
            }

            // Other Stripe errors - log and return generic error
            logger.error('Stripe API error during tax calculation', {
                stripeErrorCode,
                stripeErrorType: err.type,
                stripeErrorMessage: err.message,
                correlationId: request.headers['x-correlation-id']
            });
        }

        // Handle other errors
        logger.error('Unexpected error during tax calculation', err);
        if (err.statusCode) return response.status(err.statusCode).send(err);
        return response.status(HTTP_STATUS_SERVER_ERROR).send(err);
    }

    return response.status(HTTP_STATUS_SUCCESS_ACCEPTED).send(
        { actions: actionItems }
    );
};

async function addUpdateCartLineItems(cartId, calculation) {
    let actionItems = [];

    actionItems.push({
        action: "setCustomType",
        type: {
            key: `${CTP_TYPE_TAX_TXN_KEY}`,
            typeId: "type"
        },
        fields: {
            taxCalculationReference: calculation.id
        }
    });

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

    for (const cartLineItem of cartRequest.lineItems) {
        let lineItemData = {};
        lineItemData.amount = cartLineItem.totalPrice?.centAmount;
        lineItemData.reference = cartLineItem.id;

        // Get tax code dynamically using tax code service
        lineItemData.tax_code = taxCodeService.getTaxCodeForProduct(cartLineItem);

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