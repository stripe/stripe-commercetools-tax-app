import _ from 'lodash';
import {logger} from '../utils/logger.utils.js';
import {
    HTTP_STATUS_BAD_REQUEST,
    HTTP_STATUS_SUCCESS_ACCEPTED,
} from '../constants/http.status.constants.js';

import CustomError from '../errors/custom.error.js';
import taxOrchestratorService from '../services/tax-orchestrator.service.js';
import TaxErrorHandlerService from '../services/tax-error-handler.service.js';

export const taxHandler = async (request, response) => {

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

    try {
        const result = await taxOrchestratorService.orchestrateTaxCalculation(cartRequestBody);

        logger.info(`Tax calculation completed successfully`);

        return response.status(HTTP_STATUS_SUCCESS_ACCEPTED).send(result);
    } catch (err) {
        return TaxErrorHandlerService.handleTaxCalculationError(err, request, response, cartRequestBody);
    }

};