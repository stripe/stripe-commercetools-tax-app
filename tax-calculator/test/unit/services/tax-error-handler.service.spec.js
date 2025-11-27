import { expect, describe, it, jest, beforeEach } from '@jest/globals';
import TaxErrorHandlerService from '../../../src/services/tax-error-handler.service.js';
import ShipFromNotFoundError from '../../../src/errors/shipFromNotFoundError.js';
import TaxCodeNotFoundError from '../../../src/errors/taxCodeNotFound.error.js';
import TaxCodeShippingNotFoundError from '../../../src/errors/taxCodeShippingNotFound.error.js';
import {
  HTTP_STATUS_BAD_REQUEST,
  HTTP_STATUS_SERVER_ERROR
} from '../../../src/constants/http.status.constants.js';

// Mock logger
jest.mock('../../../src/utils/logger.utils.js', () => ({
  logger: {
    error: jest.fn()
  }
}));

import { logger } from '../../../src/utils/logger.utils.js';

describe('TaxErrorHandlerService', () => {
  let mockRequest;
  let mockResponse;
  let statusSpy;
  let jsonSpy;
  let sendSpy;
  let cartRequestBody;

  beforeEach(() => {
    mockRequest = {
      headers: {
        'x-correlation-id': 'test-correlation-id'
      }
    };

    mockResponse = {
      status: jest.fn(),
      json: jest.fn(),
      send: jest.fn()
    };

    // Make status() return mockResponse for chaining
    statusSpy = mockResponse.status.mockReturnValue(mockResponse);
    // Make json() and send() return mockResponse for chaining
    jsonSpy = mockResponse.json.mockReturnValue(mockResponse);
    sendSpy = mockResponse.send.mockReturnValue(mockResponse);

    cartRequestBody = {
      country: 'US',
      shippingMode: 'Single',
      shippingAddress: {
        state: 'NY'
      }
    };

    jest.clearAllMocks();
  });

  describe('handleTaxCalculationError', () => {
    it('should handle ShipFromNotFoundError', () => {
      const error = new ShipFromNotFoundError('Ship-from not found', { id: 'cart-123' });
      const result = TaxErrorHandlerService.handleTaxCalculationError(
        error,
        mockRequest,
        mockResponse,
        cartRequestBody
      );

      expect(result).toBeDefined();
      expect(statusSpy).toHaveBeenCalledWith(HTTP_STATUS_BAD_REQUEST);
      expect(jsonSpy).toHaveBeenCalledWith({
        errors: [error.toCommercetoolsError()]
      });
      expect(logger.error).toHaveBeenCalledWith(
        'Ship-from address not found',
        { cartId: 'cart-123' }
      );
    });

    it('should handle TaxCodeNotFoundError', () => {
      const error = new TaxCodeNotFoundError('product-1', 'Test Product', [
        { id: 'cat1', name: 'Category 1' }
      ]);
      const result = TaxErrorHandlerService.handleTaxCalculationError(
        error,
        mockRequest,
        mockResponse,
        cartRequestBody
      );

      expect(result).toBeDefined();
      expect(statusSpy).toHaveBeenCalledWith(HTTP_STATUS_BAD_REQUEST);
      expect(jsonSpy).toHaveBeenCalledWith({
        errors: [error.toCommerceToolsError()]
      });
      expect(logger.error).toHaveBeenCalledWith(
        'Tax code not found',
        {
          productId: 'product-1',
          categories: [{ id: 'cat1', name: 'Category 1' }]
        }
      );
    });

    it('should handle TaxCodeShippingNotFoundError', () => {
      const error = new TaxCodeShippingNotFoundError(
        'shipping-1',
        'shipping-type-1',
        { name: 'Standard Shipping' },
        'Single'
      );
      const result = TaxErrorHandlerService.handleTaxCalculationError(
        error,
        mockRequest,
        mockResponse,
        cartRequestBody
      );

      expect(result).toBeDefined();
      expect(statusSpy).toHaveBeenCalledWith(HTTP_STATUS_BAD_REQUEST);
      expect(jsonSpy).toHaveBeenCalledWith({
        errors: [error.toCommerceToolsError()]
      });
      expect(logger.error).toHaveBeenCalledWith(
        'Tax code shipping not found',
        { shippingArray: undefined }
      );
    });

    it('should handle Stripe errors', () => {
      const stripeError = {
        type: 'StripeInvalidRequestError',
        code: 'taxes_calculation_failed',
        message: 'Tax calculation failed'
      };

      const result = TaxErrorHandlerService.handleTaxCalculationError(
        stripeError,
        mockRequest,
        mockResponse,
        cartRequestBody
      );

      expect(result).toBeDefined();
      expect(statusSpy).toHaveBeenCalledWith(HTTP_STATUS_BAD_REQUEST);
    });

    it('should handle other errors', () => {
      const error = new Error('Generic error');
      const result = TaxErrorHandlerService.handleTaxCalculationError(
        error,
        mockRequest,
        mockResponse,
        cartRequestBody
      );

      expect(result).toBeDefined();
      expect(logger.error).toHaveBeenCalledWith(
        'Unexpected error during tax calculation',
        error
      );
    });
  });

  describe('handleShipFromNotFoundError', () => {
    it('should return proper error response', () => {
      const error = new ShipFromNotFoundError('Ship-from not found', { id: 'cart-123' });
      const result = TaxErrorHandlerService.handleShipFromNotFoundError(error, mockResponse);

      expect(result).toBeDefined();
      expect(statusSpy).toHaveBeenCalledWith(HTTP_STATUS_BAD_REQUEST);
      expect(jsonSpy).toHaveBeenCalledWith({
        errors: [error.toCommercetoolsError()]
      });
      expect(logger.error).toHaveBeenCalledWith(
        'Ship-from address not found',
        { cartId: 'cart-123' }
      );
    });
  });

  describe('handleTaxCodeNotFoundError', () => {
    it('should return proper error response', () => {
      const error = new TaxCodeNotFoundError('product-1', 'Test Product', [
        { id: 'cat1', name: 'Category 1' }
      ]);
      const result = TaxErrorHandlerService.handleTaxCodeNotFoundError(error, mockResponse);

      expect(result).toBeDefined();
      expect(statusSpy).toHaveBeenCalledWith(HTTP_STATUS_BAD_REQUEST);
      expect(jsonSpy).toHaveBeenCalledWith({
        errors: [error.toCommerceToolsError()]
      });
      expect(logger.error).toHaveBeenCalledWith(
        'Tax code not found',
        {
          productId: 'product-1',
          categories: [{ id: 'cat1', name: 'Category 1' }]
        }
      );
    });
  });

  describe('handleTaxCodeShippingNotFoundError', () => {
    it('should return proper error response', () => {
      const error = new TaxCodeShippingNotFoundError(
        'shipping-1',
        'shipping-type-1',
        { name: 'Standard Shipping' },
        'Single'
      );
      const result = TaxErrorHandlerService.handleTaxCodeShippingNotFoundError(error, mockResponse);

      expect(result).toBeDefined();
      expect(statusSpy).toHaveBeenCalledWith(HTTP_STATUS_BAD_REQUEST);
      expect(jsonSpy).toHaveBeenCalledWith({
        errors: [error.toCommerceToolsError()]
      });
      expect(logger.error).toHaveBeenCalledWith(
        'Tax code shipping not found',
        { shippingArray: undefined }
      );
    });
  });

  describe('isStripeError', () => {
    it('should return true for StripeInvalidRequestError', () => {
      const error = { type: 'StripeInvalidRequestError' };
      expect(TaxErrorHandlerService.isStripeError(error)).toBe(true);
    });

    it('should return true for StripeAPIError', () => {
      const error = { type: 'StripeAPIError' };
      expect(TaxErrorHandlerService.isStripeError(error)).toBe(true);
    });

    it('should return false for other error types', () => {
      const error = { type: 'GenericError' };
      expect(TaxErrorHandlerService.isStripeError(error)).toBe(false);
    });

    it('should return false for errors without type', () => {
      const error = { message: 'Some error' };
      expect(TaxErrorHandlerService.isStripeError(error)).toBe(false);
    });
  });

  describe('handleStripeError', () => {
    it('should handle taxes_calculation_failed error', () => {
      const stripeError = {
        type: 'StripeInvalidRequestError',
        code: 'taxes_calculation_failed',
        message: 'Tax calculation failed'
      };

      const result = TaxErrorHandlerService.handleStripeError(
        stripeError,
        mockRequest,
        mockResponse,
        cartRequestBody
      );

      expect(result).toBeDefined();
      expect(statusSpy).toHaveBeenCalledWith(HTTP_STATUS_BAD_REQUEST);
      expect(logger.error).toHaveBeenCalledWith(
        'Stripe tax calculation failed - missing tax rate or unsupported country',
        expect.objectContaining({
          stripeErrorCode: 'taxes_calculation_failed',
          stripeErrorType: 'StripeInvalidRequestError',
          country: 'US',
          state: 'NY'
        })
      );
    });

    it('should handle invalid_tax_location error', () => {
      const stripeError = {
        type: 'StripeInvalidRequestError',
        code: 'invalid_tax_location',
        message: 'Invalid tax location'
      };

      const result = TaxErrorHandlerService.handleStripeError(
        stripeError,
        mockRequest,
        mockResponse,
        cartRequestBody
      );

      expect(result).toBeDefined();
      expect(statusSpy).toHaveBeenCalledWith(HTTP_STATUS_BAD_REQUEST);
    });

    it('should handle customer_tax_location_invalid error', () => {
      const stripeError = {
        type: 'StripeInvalidRequestError',
        code: 'customer_tax_location_invalid',
        message: 'Invalid customer tax location'
      };

      const result = TaxErrorHandlerService.handleStripeError(
        stripeError,
        mockRequest,
        mockResponse,
        cartRequestBody
      );

      expect(result).toBeDefined();
      expect(statusSpy).toHaveBeenCalledWith(HTTP_STATUS_BAD_REQUEST);
    });

    it('should handle shipping_address_invalid error', () => {
      const stripeError = {
        type: 'StripeInvalidRequestError',
        code: 'shipping_address_invalid',
        message: 'Invalid shipping address'
      };

      const result = TaxErrorHandlerService.handleStripeError(
        stripeError,
        mockRequest,
        mockResponse,
        cartRequestBody
      );

      expect(result).toBeDefined();
      expect(statusSpy).toHaveBeenCalledWith(HTTP_STATUS_BAD_REQUEST);
    });

    it('should handle stripe_tax_inactive error', () => {
      const stripeError = {
        type: 'StripeInvalidRequestError',
        code: 'stripe_tax_inactive',
        message: 'Stripe Tax is not activated'
      };

      const result = TaxErrorHandlerService.handleStripeError(
        stripeError,
        mockRequest,
        mockResponse,
        cartRequestBody
      );

      expect(result).toBeDefined();
      expect(statusSpy).toHaveBeenCalledWith(HTTP_STATUS_BAD_REQUEST);
      expect(jsonSpy).toHaveBeenCalledWith({
        errors: [{
          code: 'InvalidInput',
          message: 'Stripe Tax is not activated. Please enable Stripe Tax in your Stripe Dashboard.',
          extensionExtraInfo: {
            originalError: 'stripe_tax_inactive',
            action: 'Enable Stripe Tax at https://dashboard.stripe.com/settings/tax'
          }
        }]
      });
    });

    it('should handle other Stripe errors with generic message', () => {
      const stripeError = {
        type: 'StripeAPIError',
        code: 'unknown_error',
        message: 'Unknown Stripe error'
      };

      const result = TaxErrorHandlerService.handleStripeError(
        stripeError,
        mockRequest,
        mockResponse,
        cartRequestBody
      );

      expect(result).toBeDefined();
      expect(statusSpy).toHaveBeenCalledWith(HTTP_STATUS_SERVER_ERROR);
      expect(logger.error).toHaveBeenCalledWith(
        'Stripe API error during tax calculation',
        expect.objectContaining({
          stripeErrorCode: 'unknown_error',
          stripeErrorType: 'StripeAPIError'
        })
      );
      expect(jsonSpy).toHaveBeenCalledWith({
        errors: [{
          code: 'ExternalServiceError',
          message: 'Stripe API error during tax calculation. Please try again later or contact support if the issue persists.',
          extensionExtraInfo: {
            originalError: 'StripeAPIError',
            stripeErrorCode: 'unknown_error',
            action: 'Please try again later or contact support if the issue persists'
          }
        }]
      });
    });

    it('should handle Multiple shipping mode', () => {
      const stripeError = {
        type: 'StripeInvalidRequestError',
        code: 'taxes_calculation_failed',
        message: 'Tax calculation failed'
      };

      const multipleShippingCart = {
        country: 'US',
        shippingMode: 'Multiple',
        shipping: [
          {
            shippingAddress: {
              state: 'CA'
            }
          }
        ]
      };

      const result = TaxErrorHandlerService.handleStripeError(
        stripeError,
        mockRequest,
        mockResponse,
        multipleShippingCart
      );

      expect(result).toBeDefined();
      expect(logger.error).toHaveBeenCalledWith(
        'Stripe tax calculation failed - missing tax rate or unsupported country',
        expect.objectContaining({
          country: 'US',
          state: 'CA'
        })
      );
    });

    it('should handle cart without state', () => {
      const stripeError = {
        type: 'StripeInvalidRequestError',
        code: 'taxes_calculation_failed',
        message: 'Tax calculation failed'
      };

      const cartWithoutState = {
        country: 'US',
        shippingMode: 'Single',
        shippingAddress: {}
      };

      const result = TaxErrorHandlerService.handleStripeError(
        stripeError,
        mockRequest,
        mockResponse,
        cartWithoutState
      );

      expect(result).toBeDefined();
      expect(logger.error).toHaveBeenCalledWith(
        'Stripe tax calculation failed - missing tax rate or unsupported country',
        expect.objectContaining({
          country: 'US',
          state: undefined
        })
      );
    });
  });

  describe('handleOtherErrors', () => {
    it('should handle error with statusCode', () => {
      const error = {
        message: 'Error with status',
        statusCode: 404
      };

      const result = TaxErrorHandlerService.handleOtherErrors(error, mockResponse);

      expect(result).toBeDefined();
      expect(statusSpy).toHaveBeenCalledWith(404);
      expect(sendSpy).toHaveBeenCalledWith(error);
      expect(logger.error).toHaveBeenCalledWith(
        'Unexpected error during tax calculation',
        error
      );
    });

    it('should handle error without statusCode', () => {
      const error = new Error('Generic error');

      const result = TaxErrorHandlerService.handleOtherErrors(error, mockResponse);

      expect(result).toBeDefined();
      expect(statusSpy).toHaveBeenCalledWith(HTTP_STATUS_SERVER_ERROR);
      expect(sendSpy).toHaveBeenCalledWith(error);
      expect(logger.error).toHaveBeenCalledWith(
        'Unexpected error during tax calculation',
        error
      );
    });
  });
});

