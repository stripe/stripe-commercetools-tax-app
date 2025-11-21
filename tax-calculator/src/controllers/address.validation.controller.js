import { logger } from '../utils/logger.utils.js';
import {
    HTTP_STATUS_BAD_REQUEST,
    HTTP_STATUS_SUCCESS_ACCEPTED,
    HTTP_STATUS_SERVER_ERROR
} from '../constants/http.status.constants.js';
import addressService from '../services/address.service.js';

/**
 * Address validation handler
 * Handles only the HTTP layer (request/response)
 * All errors are handled directly without using next()
 */
export async function validateAddressHandler(req, res) {
    const requestId = req.headers['x-request-id'] || `req_${Date.now()}`;
    
    try {
        // Basic HTTP layer validation - only structure checks
        const { address } = req.body;

        if (!address) {
            return res.status(HTTP_STATUS_BAD_REQUEST).json({
                error: 'Address is required in request body'
            });
        }

        if (typeof address !== 'object' || Array.isArray(address)) {
            return res.status(HTTP_STATUS_BAD_REQUEST).json({
                error: 'Address must be a valid object'
            });
        }

        logger.info('Address validation request received', {
            requestId,
            country: address.country || 'unknown'
        });

        // Delegate all business logic to the service
        const validationResult = await addressService.validateAddress(
            address,
            requestId
        );

        logger.info('Address validation completed', {
            requestId,
            country: address.country || 'unknown',
            success: validationResult.success,
            hasStripeVerification: !!validationResult.validation.stripe
        });

        return res.status(HTTP_STATUS_SUCCESS_ACCEPTED).json(validationResult);

    } catch (error) {
        // Handle unexpected errors (service should not throw, but just in case)
        logger.error('Unexpected address validation error', {
            requestId,
            error: error.message,
            stack: error.stack
        });
        
        return res.status(HTTP_STATUS_SERVER_ERROR).json({
            error: 'An unexpected error occurred during address validation',
            message: error.message
        });
    }
}