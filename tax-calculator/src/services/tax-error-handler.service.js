// src/services/tax-error-handler.service.js
import { logger } from '../utils/logger.utils.js';
import { HTTP_STATUS_BAD_REQUEST, HTTP_STATUS_SERVER_ERROR } from '../constants/http.status.constants.js';
import TaxCodeNotFoundError from '../errors/taxCodeNotFound.error.js';
import TaxCodeShippingNotFoundError from '../errors/taxCodeShippingNotFound.error.js';
import MissingTaxRateForCountry from '../errors/missingTaxRateForCountry.error.js';
import ShipFromNotFoundError from '../errors/shipFromNotFoundError.js';
import InvalidTaxDestinationError from '../errors/invalidTaxDestination.error.js';

/**
 * Error handler specifically for tax calculation errors
 * Handles tax code errors, Stripe API errors, and other errors
 */
class TaxErrorHandlerService {
  /**
   * Handle tax calculation errors
   * @param {Error} error - The error to handle
   * @param {Object} request - Express request object
   * @param {Object} response - Express response object
   * @param {Object} cartRequestBody - Cart request body for context
   * @returns {Object|null} Response object if handled, null if not handled
   */
  static handleTaxCalculationError(error, request, response, cartRequestBody) {
    // Handle ship-from not found errors
    if (error instanceof ShipFromNotFoundError) {
      return this.handleShipFromNotFoundError(error, response);
    }

    // Handle an unusable tax destination (delivery address without a country)
    if (error instanceof InvalidTaxDestinationError) {
      return this.handleInvalidTaxDestinationError(error, response);
    }

    // Handle tax code not found errors
    if (error instanceof TaxCodeNotFoundError) {
      return this.handleTaxCodeNotFoundError(error, response);
    }

    // Handle tax code shipping not found errors
    if (error instanceof TaxCodeShippingNotFoundError) {
      return this.handleTaxCodeShippingNotFoundError(error, response);
    }

    // Handle Stripe API errors
    if (this.isStripeError(error)) {
      return this.handleStripeError(error, request, response, cartRequestBody);
    }

    // Handle other errors
    return this.handleOtherErrors(error, response);
  }

  /**
   * Handle ShipFromNotFoundError
   * @param {ShipFromNotFoundError} error 
   * @param {Object} response 
   * @returns {Object}
   */
  static handleShipFromNotFoundError(error, response) {
    logger.error('Ship-from address not found', {
      cartId: error.cart?.id
    });
    return response.status(HTTP_STATUS_BAD_REQUEST).json({
      errors: [error.toCommercetoolsError()]
    });
  }

  /**
   * Handle InvalidTaxDestinationError — a delivery address that locates the order but names no
   * country. Refusing is deliberate: completing it from cart.country would tax the sale in a
   * jurisdiction the goods are not going to (SB3-218).
   * @param {InvalidTaxDestinationError} error
   * @param {Object} response
   * @returns {Object}
   */
  static handleInvalidTaxDestinationError(error, response) {
    logger.error('Unusable tax destination: delivery address has no country', {
      shippingKey: error.shippingKey,
      presentFields: error.presentFields
    });
    return response.status(HTTP_STATUS_BAD_REQUEST).json({
      errors: [error.toCommercetoolsError()]
    });
  }

  /**
   * Handle TaxCodeNotFoundError
   * @param {TaxCodeNotFoundError} error
   * @param {Object} response
   * @returns {Object}
   */
  static handleTaxCodeNotFoundError(error, response) {
    logger.error('Tax code not found', {
      productId: error.productId,
      categories: error.categories
    });
    return response.status(HTTP_STATUS_BAD_REQUEST).json({
      errors: [error.toCommerceToolsError()]
    });
  }

  /**
   * Handle TaxCodeShippingNotFoundError
   * @param {TaxCodeShippingNotFoundError} error 
   * @param {Object} response 
   * @returns {Object}
   */
  static handleTaxCodeShippingNotFoundError(error, response) {
    logger.error('Tax code shipping not found', {
      shippingArray: error.shippingArray
    });
    return response.status(HTTP_STATUS_BAD_REQUEST).json({
      errors: [error.toCommerceToolsError()]
    });
  }

  /**
   * Check if error is a Stripe API error
   * @param {Error} error 
   * @returns {boolean}
   */
  static isStripeError(error) {
    return error.type === 'StripeInvalidRequestError' || error.type === 'StripeAPIError';
  }

  /**
   * Handle Stripe API errors
   * @param {Error} error 
   * @param {Object} request 
   * @param {Object} response 
   * @param {Object} cartRequestBody 
   * @returns {Object}
   */
  static handleStripeError(error, request, response, cartRequestBody) {
    const country = cartRequestBody.country;
    const state = cartRequestBody.shippingMode === 'Single'
      ? cartRequestBody.shippingAddress?.state
      : cartRequestBody.shipping?.[0]?.shippingAddress?.state;

    // Map Stripe error codes to appropriate responses
    const stripeErrorCode = error.code;

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
        stripeErrorType: error.type,
        stripeErrorMessage: error.message,
        country,
        state,
        correlationId: request.headers['x-correlation-id']
      });

      const missingTaxRateError = MissingTaxRateForCountry.fromStripeError(error, country, state);
      return response.status(HTTP_STATUS_BAD_REQUEST).json({
        errors: [missingTaxRateError.toCommerceToolsError()]
      });
    }

    // Handle stripe_tax_inactive specifically
    if (stripeErrorCode === 'stripe_tax_inactive') {
      logger.error('Stripe Tax not activated', {
        stripeErrorMessage: error.message,
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
      stripeErrorType: error.type,
      stripeErrorMessage: error.message,
      correlationId: request.headers['x-correlation-id']
    });

    // Return generic error for unexpected Stripe errors
    return response.status(HTTP_STATUS_SERVER_ERROR).json({
      errors: [{
        code: 'ExternalServiceError',
        message: 'Stripe API error during tax calculation. Please try again later or contact support if the issue persists.',
        extensionExtraInfo: {
          originalError: error.type,
          stripeErrorCode: error.code,
          action: 'Please try again later or contact support if the issue persists'
        }
      }]
    });
  }

  /**
   * Handle other errors
   * @param {Error} error 
   * @param {Object} response 
   * @returns {Object}
   */
  static handleOtherErrors(error, response) {
    logger.error(`Unexpected error during tax calculation: ${error.message}`);
    if (error.statusCode) return response.status(error.statusCode).send(error);
    return response.status(HTTP_STATUS_SERVER_ERROR).send(error);
  }
}

export default TaxErrorHandlerService;