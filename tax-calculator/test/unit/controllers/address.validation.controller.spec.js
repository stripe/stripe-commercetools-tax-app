import { expect, describe, it, jest, beforeEach } from '@jest/globals';

// Mock dependencies BEFORE importing
jest.mock('../../../src/utils/logger.utils.js', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn()
  }
}));

jest.mock('../../../src/services/address.service.js', () => ({
  __esModule: true,
  default: {
    validateAddress: jest.fn()
  }
}));

import { logger } from '../../../src/utils/logger.utils.js';
import addressService from '../../../src/services/address.service.js';
import { validateAddressHandler } from '../../../src/controllers/address.validation.controller.js';
import {
  HTTP_STATUS_BAD_REQUEST,
  HTTP_STATUS_SUCCESS_ACCEPTED,
  HTTP_STATUS_SERVER_ERROR
} from '../../../src/constants/http.status.constants.js';

describe('AddressValidationController', () => {
  let mockRequest;
  let mockResponse;
  let statusSpy;
  let jsonSpy;

  beforeEach(() => {
    jsonSpy = jest.fn();
    statusSpy = jest.fn().mockReturnValue({ json: jsonSpy });
    
    mockRequest = {
      body: {},
      headers: {}
    };

    mockResponse = {
      status: statusSpy,
      json: jsonSpy
    };

    jest.clearAllMocks();
  });

  describe('validateAddressHandler', () => {
    it('should return 400 when address is missing in request body', async () => {
      mockRequest.body = {};

      await validateAddressHandler(mockRequest, mockResponse);

      expect(statusSpy).toHaveBeenCalledWith(HTTP_STATUS_BAD_REQUEST);
      expect(jsonSpy).toHaveBeenCalledWith({
        error: 'Address is required in request body'
      });
    });

    it('should return 400 when address is not an object', async () => {
      mockRequest.body = { address: 'not-an-object' };

      await validateAddressHandler(mockRequest, mockResponse);

      expect(statusSpy).toHaveBeenCalledWith(HTTP_STATUS_BAD_REQUEST);
      expect(jsonSpy).toHaveBeenCalledWith({
        error: 'Address must be a valid object'
      });
    });

    it('should return 400 when address is an array', async () => {
      mockRequest.body = { address: [] };

      await validateAddressHandler(mockRequest, mockResponse);

      expect(statusSpy).toHaveBeenCalledWith(HTTP_STATUS_BAD_REQUEST);
      expect(jsonSpy).toHaveBeenCalledWith({
        error: 'Address must be a valid object'
      });
    });

    it('should call addressService and return 202 with validation result on success', async () => {
      const address = {
        country: 'US',
        line1: '123 Main St',
        city: 'New York',
        state: 'NY',
        postal_code: '10001'
      };

      const validationResult = {
        success: true,
        address: {
          country: 'US',
          line1: '123 Main St',
          city: 'New York',
          state: 'NY',
          postal_code: '10001'
        },
        validation: {
          local: { isValid: true, errors: [] },
          stripe: { isValid: true }
        }
      };

      mockRequest.body = { address };
      mockRequest.headers['x-request-id'] = 'test-request-id';
      addressService.validateAddress.mockResolvedValue(validationResult);

      await validateAddressHandler(mockRequest, mockResponse);

      expect(logger.info).toHaveBeenCalledWith(
        'Address validation request received',
        {
          requestId: 'test-request-id',
          country: 'US'
        }
      );

      expect(addressService.validateAddress).toHaveBeenCalledWith(
        address,
        'test-request-id'
      );

      expect(logger.info).toHaveBeenCalledWith(
        'Address validation completed',
        {
          requestId: 'test-request-id',
          country: 'US',
          success: true,
          hasStripeVerification: true
        }
      );

      expect(statusSpy).toHaveBeenCalledWith(HTTP_STATUS_SUCCESS_ACCEPTED);
      expect(jsonSpy).toHaveBeenCalledWith(validationResult);
    });

    it('should generate requestId when x-request-id header is missing', async () => {
      const address = { country: 'US' };
      const validationResult = {
        success: true,
        address,
        validation: { local: { isValid: true }, stripe: null }
      };

      mockRequest.body = { address };
      mockRequest.headers = {};
      addressService.validateAddress.mockResolvedValue(validationResult);

      await validateAddressHandler(mockRequest, mockResponse);

      expect(addressService.validateAddress).toHaveBeenCalledWith(
        address,
        expect.stringMatching(/^req_\d+$/)
      );
    });

    it('should handle address with unknown country', async () => {
      const address = {};
      const validationResult = {
        success: false,
        address,
        validation: { local: { isValid: false, errors: [] } }
      };

      mockRequest.body = { address };
      addressService.validateAddress.mockResolvedValue(validationResult);

      await validateAddressHandler(mockRequest, mockResponse);

      expect(logger.info).toHaveBeenCalledWith(
        'Address validation request received',
        {
          requestId: expect.any(String),
          country: 'unknown'
        }
      );
    });

    it('should return 500 when addressService throws an error', async () => {
      const address = { country: 'US' };
      const error = new Error('Service error');

      mockRequest.body = { address };
      mockRequest.headers['x-request-id'] = 'test-request-id';
      addressService.validateAddress.mockRejectedValue(error);

      await validateAddressHandler(mockRequest, mockResponse);

      expect(logger.error).toHaveBeenCalledWith(
        'Unexpected address validation error',
        {
          requestId: 'test-request-id',
          error: 'Service error',
          stack: expect.any(String)
        }
      );

      expect(statusSpy).toHaveBeenCalledWith(HTTP_STATUS_SERVER_ERROR);
      expect(jsonSpy).toHaveBeenCalledWith({
        error: 'An unexpected error occurred during address validation',
        message: 'Service error'
      });
    });

    it('should handle validation result without stripe verification', async () => {
      const address = { country: 'US' };
      const validationResult = {
        success: true,
        address,
        validation: { local: { isValid: true }, stripe: null }
      };

      mockRequest.body = { address };
      addressService.validateAddress.mockResolvedValue(validationResult);

      await validateAddressHandler(mockRequest, mockResponse);

      expect(logger.info).toHaveBeenCalledWith(
        'Address validation completed',
        {
          requestId: expect.any(String),
          country: 'US',
          success: true,
          hasStripeVerification: false
        }
      );
    });
  });
});

