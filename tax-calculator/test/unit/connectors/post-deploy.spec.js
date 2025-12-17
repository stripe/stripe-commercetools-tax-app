// tax-calculator/test/unit/controllers/tax-calculator.controller.spec.js
import { expect, describe, it, jest, beforeEach } from '@jest/globals';
import { HTTP_STATUS_BAD_REQUEST, HTTP_STATUS_SUCCESS_ACCEPTED } from '../../../src/constants/http.status.constants.js';
import { taxHandler } from '../../../src/controllers/tax.calculator.controller.js';
import CustomError from '../../../src/errors/custom.error.js';

// Mock dependencies
jest.mock('../../../src/utils/logger.utils.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

jest.mock('../../../src/services/tax-orchestrator.service.js', () => ({
  default: {
    orchestrateTaxCalculation: jest.fn()
  }
}));

jest.mock('../../../src/services/tax-error-handler.service.js', () => ({
  default: {
    handleTaxCalculationError: jest.fn()
  }
}));

jest.mock('lodash', () => ({
  isEmpty: jest.fn()
}));

import { logger } from '../../../src/utils/logger.utils.js';
import taxOrchestratorService from '../../../src/services/tax-orchestrator.service.js';
import TaxErrorHandlerService from '../../../src/services/tax-error-handler.service.js';
import _ from 'lodash';

describe('tax-calculator.controller', () => {
  let mockRequest;
  let mockResponse;

  beforeEach(() => {
    jest.clearAllMocks();

    taxOrchestratorService.orchestrateTaxCalculation = jest.fn();
    TaxErrorHandlerService.handleTaxCalculationError = jest.fn();

    mockRequest = {
      body: {
        resource: {
          obj: {
            id: 'cart-1',
            shippingMode: 'Single',
            lineItems: [
              {
                id: 'line-item-1',
                productId: 'product-1',
                totalPrice: {
                  centAmount: 5000
                }
              }
            ]
          }
        }
      }
    };

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };

    _.isEmpty.mockReturnValue(false);
  });

  describe('taxHandler', () => {
    it('should return 400 when request body is invalid (missing, empty, null, or undefined)', async () => {
      const invalidBodies = [
        {},
        { resource: {} },
        { resource: { obj: {} } },
        null,
        undefined
      ];

      for (const invalidBody of invalidBodies) {
        jest.clearAllMocks();
        mockRequest.body = invalidBody;
        // All these cases should result in isEmpty returning true for cartRequestBody
        _.isEmpty.mockReturnValue(true);

        await taxHandler(mockRequest, mockResponse);

        expect(mockResponse.status).toHaveBeenCalledWith(HTTP_STATUS_BAD_REQUEST);
        expect(mockResponse.send).toHaveBeenCalledWith(expect.any(CustomError));
      }
    });

    it('should successfully process tax calculation and log request information', async () => {
      const mockResult = {
        actions: [
          { action: 'setCustomType' },
          { action: 'setLineItemTaxAmount', lineItemId: 'line-item-1' }
        ]
      };

      taxOrchestratorService.orchestrateTaxCalculation.mockResolvedValue(mockResult);
      _.isEmpty.mockReturnValue(false);

      await taxHandler(mockRequest, mockResponse);

      expect(taxOrchestratorService.orchestrateTaxCalculation).toHaveBeenCalledWith(
        mockRequest.body.resource.obj
      );
      expect(mockResponse.status).toHaveBeenCalledWith(HTTP_STATUS_SUCCESS_ACCEPTED);
      expect(mockResponse.send).toHaveBeenCalledWith(mockResult);
      expect(logger.info).toHaveBeenCalledWith(
        'Tax calculation request received',
        expect.objectContaining({
          cartId: 'cart-1',
          shippingMode: 'Single',
          lineItemsCount: 1
        })
      );
    });

    it('should handle errors and delegate to error handler', async () => {
      const error = new Error('Tax calculation failed');
      taxOrchestratorService.orchestrateTaxCalculation.mockRejectedValue(error);
      _.isEmpty.mockReturnValue(false);

      const mockErrorResponse = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis()
      };
      TaxErrorHandlerService.handleTaxCalculationError.mockReturnValue(mockErrorResponse);

      const result = await taxHandler(mockRequest, mockResponse);

      expect(TaxErrorHandlerService.handleTaxCalculationError).toHaveBeenCalledWith(
        error,
        mockRequest,
        mockResponse,
        mockRequest.body.resource.obj
      );
      expect(result).toBe(mockErrorResponse);
    });

    it('should handle different cart configurations (Single/Multiple mode, with/without line items)', async () => {
      const cartConfigurations = [
        {
          id: 'cart-1',
          shippingMode: 'Multiple',
          shipping: [
            {
              shippingKey: 'shipping-key-1',
              shippingInfo: { price: { centAmount: 1000 } }
            }
          ],
          lineItems: [
            {
              id: 'line-item-1',
              productId: 'product-1',
              totalPrice: { centAmount: 5000 }
            }
          ]
        },
        {
          id: 'cart-2',
          shippingMode: 'Single',
          lineItems: []
        },
        {
          id: 'cart-3',
          shippingMode: 'Single'
        },
        {
          id: 'cart-4',
          customerId: 'customer-1',
          anonymousId: 'anon-1',
          country: 'US',
          locale: 'en-US',
          shippingMode: 'Single',
          shippingAddress: {
            state: 'NY',
            city: 'New York',
            postalCode: '10001',
            streetName: '123 Main St'
          },
          shippingInfo: {
            price: { centAmount: 1000 },
            shippingMethod: { id: 'method-1' }
          },
          totalPrice: { currencyCode: 'USD' },
          lineItems: [
            {
              id: 'line-item-1',
              productId: 'product-1',
              quantity: 2,
              totalPrice: { centAmount: 2000 },
              categories: []
            },
            {
              id: 'line-item-2',
              productId: 'product-2',
              quantity: 1,
              totalPrice: { centAmount: 3000 },
              categories: []
            }
          ]
        }
      ];

      for (const cartConfig of cartConfigurations) {
        mockRequest.body.resource.obj = cartConfig;
        const mockResult = { actions: [] };
        
        taxOrchestratorService.orchestrateTaxCalculation.mockResolvedValue(mockResult);
        _.isEmpty.mockReturnValue(false);

        await taxHandler(mockRequest, mockResponse);

        expect(taxOrchestratorService.orchestrateTaxCalculation).toHaveBeenCalledWith(cartConfig);
        expect(mockResponse.status).toHaveBeenCalledWith(HTTP_STATUS_SUCCESS_ACCEPTED);
      }
    });
  });
});
