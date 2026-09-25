import _ from 'lodash';
import {logger} from '../utils/logger.utils.js';
import {
    HTTP_STATUS_BAD_REQUEST,
    HTTP_STATUS_SUCCESS_ACCEPTED,
} from '../constants/http.status.constants.js';

import CustomError from '../errors/custom.error.js';
import taxOrchestratorService from '../services/tax-orchestrator.service.js';
import TaxErrorHandlerService from '../services/tax-error-handler.service.js';

function isReapplyScenario(cart) {
    const taxedPriceCleared = !cart.taxedPrice;
    const shippingTaxCleared = cart.shippingMode === 'Single'
        && cart.shippingInfo != null
        && !cart.shippingInfo.taxedPrice;

    return (
        cart.paymentInfo != null &&
        (taxedPriceCleared || shippingTaxCleared) &&
        (cart.custom?.fields?.connectorStripeTax_calculationReferences?.length ?? 0) > 0
    );
}

export const taxHandler = async (request, response) => {

    const cartRequestBody = request.body?.resource?.obj;
    if (_.isEmpty(cartRequestBody)) {
        logger.warn('Tax calculation request rejected: missing cart information', {
            hasBody: !!request.body,
            hasResource: !!request.body?.resource
        });
        return response
            .status(HTTP_STATUS_BAD_REQUEST)
            .send(
                new CustomError(
                    HTTP_STATUS_BAD_REQUEST,
                    'Missing cart information in the request body.'
                )
            );
    }

    const reapply = isReapplyScenario(cartRequestBody);

    logger.info('Tax calculation request received', {
        cartId: cartRequestBody.id,
        cartVersion: cartRequestBody.version,
        customerId: cartRequestBody.customerId ? '[PRESENT]' : null,
        anonymousId: cartRequestBody.anonymousId ? '[PRESENT]' : null,
        lineItemsCount: cartRequestBody.lineItems?.length || 0,
        shippingMode: cartRequestBody.shippingMode,
        country: cartRequestBody.country,
        currency: cartRequestBody.totalPrice?.currencyCode,
        totalAmount: cartRequestBody.totalPrice?.centAmount,
        reapply
    });

    if (reapply) {
        logger.info('Tax re-apply scenario detected: restoring existing calculation', {
            cartId: cartRequestBody.id,
            calculationId: cartRequestBody.custom.fields.connectorStripeTax_calculationReferences[0]
        });
    }

    try {
        const result = reapply
            ? await taxOrchestratorService.reapplyExistingCalculation(cartRequestBody)
            : await taxOrchestratorService.orchestrateTaxCalculation(cartRequestBody);

        return response.status(HTTP_STATUS_SUCCESS_ACCEPTED).send(result);
    } catch (err) {
        return TaxErrorHandlerService.handleTaxCalculationError(err, request, response, cartRequestBody);
    }

};