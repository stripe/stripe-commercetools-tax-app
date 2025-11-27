import { expect, describe, it, jest, beforeEach } from '@jest/globals';
import { syncHandler } from '../../../src/controllers/sync.controller.js';
import {
  HTTP_STATUS_SUCCESS_ACCEPTED,
  HTTP_STATUS_SUCCESS_NO_CONTENT,
  HTTP_STATUS_SERVER_ERROR,
} from '../../../src/constants/http.status.constants.js';
import CustomError from '../../../src/errors/custom.error.js';
import { ORDER_TAX_FIELD_NAMES } from '../../../src/connectors/customTypes.js';

// Mock dependencies
jest.mock('../../../src/utils/logger.util.js', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../../src/utils/decoder.util.js', () => ({
  decodeToJson: jest.fn(),
}));

jest.mock('../../../src/validators/order-change.validators.js', () => ({
  doValidation: jest.fn(),
}));

jest.mock('../../../src/clients/query.client.js', () => ({
  getCartByOrderId: jest.fn(),
}));

jest.mock('../../../src/clients/update.client.js', () => ({
  updateOrderTaxTxn: jest.fn(),
}));

jest.mock('../../../src/extensions/stripe/clients/client.js', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import { logger } from '../../../src/utils/logger.util.js';
import { decodeToJson } from '../../../src/utils/decoder.util.js';
import { doValidation } from '../../../src/validators/order-change.validators.js';
import { getCartByOrderId } from '../../../src/clients/query.client.js';
import { updateOrderTaxTxn } from '../../../src/clients/update.client.js';
import createTaxTransaction from '../../../src/extensions/stripe/clients/client.js';

describe('sync.controller.spec', () => {
  let mockRequest;
  let mockResponse;
  let responseStatusSpy;
  let responseSendSpy;

  beforeEach(() => {
    jest.clearAllMocks();

    mockRequest = {
      method: 'POST',
      url: '/',
      body: {},
    };

    responseSendSpy = jest.fn();
    responseStatusSpy = jest.fn().mockReturnValue({
      send: responseSendSpy,
    });

    mockResponse = {
      status: responseStatusSpy,
      send: responseSendSpy,
    };
  });

  describe('syncHandler - Message validation', () => {
    it('should return 202 HTTP status when message data is missing in incoming event message', async () => {
      mockRequest.body = {
        message: {},
      };

      await syncHandler(mockRequest, mockResponse);

      expect(responseStatusSpy).toHaveBeenCalledWith(HTTP_STATUS_SUCCESS_ACCEPTED);
      expect(responseSendSpy).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalled();
    });

    it('should return 202 HTTP status when message property is missing', async () => {
      mockRequest.body = {};

      await syncHandler(mockRequest, mockResponse);

      expect(responseStatusSpy).toHaveBeenCalledWith(HTTP_STATUS_SUCCESS_ACCEPTED);
      expect(logger.error).toHaveBeenCalled();
    });

    it('should handle decoding errors', async () => {
      const encodedMessage = 'encoded-base64-string';
      mockRequest.body = {
        message: {
          data: encodedMessage,
        },
      };

      const decodeError = new Error('Invalid JSON');
      decodeToJson.mockImplementation(() => {
        throw decodeError;
      });

      await syncHandler(mockRequest, mockResponse);

      expect(decodeToJson).toHaveBeenCalledWith(encodedMessage);
      expect(responseStatusSpy).toHaveBeenCalledWith(HTTP_STATUS_SERVER_ERROR);
      expect(logger.error).toHaveBeenCalled();
    });

    it('should handle validation errors', async () => {
      const encodedMessage = 'encoded-base64-string';
      const decodedMessage = {
        notificationType: 'Message',
        type: 'InvalidType',
        resource: { typeId: 'order', id: 'order-123' },
      };

      mockRequest.body = {
        message: {
          data: encodedMessage,
        },
      };

      decodeToJson.mockReturnValue(decodedMessage);

      const validationError = new CustomError(
        HTTP_STATUS_SUCCESS_ACCEPTED,
        'Message type InvalidType is incorrect.'
      );
      doValidation.mockImplementation(() => {
        throw validationError;
      });

      await syncHandler(mockRequest, mockResponse);

      expect(decodeToJson).toHaveBeenCalledWith(encodedMessage);
      expect(doValidation).toHaveBeenCalledWith(decodedMessage);
      expect(responseStatusSpy).toHaveBeenCalledWith(HTTP_STATUS_SUCCESS_ACCEPTED);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('syncHandler - Cart retrieval', () => {
    it('should return 204 when cart is not found', async () => {
      const encodedMessage = 'encoded-base64-string';
      const decodedMessage = {
        notificationType: 'Message',
        type: 'OrderCreated',
        resource: { typeId: 'order', id: 'order-123' },
      };

      mockRequest.body = {
        message: {
          data: encodedMessage,
        },
      };

      decodeToJson.mockReturnValue(decodedMessage);
      doValidation.mockImplementation(() => {});
      getCartByOrderId.mockResolvedValue(null);

      await syncHandler(mockRequest, mockResponse);

      expect(getCartByOrderId).toHaveBeenCalledWith('order-123');
      expect(responseStatusSpy).toHaveBeenCalledWith(HTTP_STATUS_SUCCESS_NO_CONTENT);
      expect(responseSendSpy).toHaveBeenCalled();
      expect(createTaxTransaction).not.toHaveBeenCalled();
    });

    it('should return 204 when cart is undefined', async () => {
      const encodedMessage = 'encoded-base64-string';
      const decodedMessage = {
        notificationType: 'Message',
        type: 'OrderCreated',
        resource: { typeId: 'order', id: 'order-123' },
      };

      mockRequest.body = {
        message: {
          data: encodedMessage,
        },
      };

      decodeToJson.mockReturnValue(decodedMessage);
      doValidation.mockImplementation(() => {});
      getCartByOrderId.mockResolvedValue(undefined);

      await syncHandler(mockRequest, mockResponse);

      expect(getCartByOrderId).toHaveBeenCalledWith('order-123');
      expect(responseStatusSpy).toHaveBeenCalledWith(HTTP_STATUS_SUCCESS_NO_CONTENT);
      expect(createTaxTransaction).not.toHaveBeenCalled();
    });

    it('should handle errors when retrieving cart', async () => {
      const encodedMessage = 'encoded-base64-string';
      const decodedMessage = {
        notificationType: 'Message',
        type: 'OrderCreated',
        resource: { typeId: 'order', id: 'order-123' },
      };

      mockRequest.body = {
        message: {
          data: encodedMessage,
        },
      };

      decodeToJson.mockReturnValue(decodedMessage);
      doValidation.mockImplementation(() => {});

      const cartError = new CustomError(
        HTTP_STATUS_SUCCESS_ACCEPTED,
        'Order not found'
      );
      getCartByOrderId.mockRejectedValue(cartError);

      await syncHandler(mockRequest, mockResponse);

      expect(getCartByOrderId).toHaveBeenCalledWith('order-123');
      expect(responseStatusSpy).toHaveBeenCalledWith(HTTP_STATUS_SUCCESS_ACCEPTED);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('syncHandler - Tax transaction creation', () => {
    it('should successfully sync order to tax provider and return 204', async () => {
      const encodedMessage = 'encoded-base64-string';
      const orderId = 'order-123';
      const decodedMessage = {
        notificationType: 'Message',
        type: 'OrderCreated',
        resource: { typeId: 'order', id: orderId },
      };

      const mockCart = {
        id: 'cart-123',
        custom: {
          fields: {
            [ORDER_TAX_FIELD_NAMES.CALCULATION_REFERENCES]: ['calc_123'],
          },
        },
      };

      const mockTaxTransactions = [
        { id: 'txn_123' },
        { id: 'txn_456' },
      ];

      mockRequest.body = {
        message: {
          data: encodedMessage,
        },
      };

      decodeToJson.mockReturnValue(decodedMessage);
      doValidation.mockImplementation(() => {});
      getCartByOrderId.mockResolvedValue(mockCart);
      createTaxTransaction.mockResolvedValue(mockTaxTransactions);
      updateOrderTaxTxn.mockResolvedValue({ body: {} });

      await syncHandler(mockRequest, mockResponse);

      expect(getCartByOrderId).toHaveBeenCalledWith(orderId);
      expect(createTaxTransaction).toHaveBeenCalledWith(orderId, mockCart);
      expect(updateOrderTaxTxn).toHaveBeenCalledWith(mockTaxTransactions, orderId);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining(`Tax transactions from Stripe of order ${orderId}`)
      );
      expect(responseStatusSpy).toHaveBeenCalledWith(HTTP_STATUS_SUCCESS_NO_CONTENT);
      expect(responseSendSpy).toHaveBeenCalled();
    });

    it('should handle empty tax transactions array', async () => {
      const encodedMessage = 'encoded-base64-string';
      const orderId = 'order-123';
      const decodedMessage = {
        notificationType: 'Message',
        type: 'OrderCreated',
        resource: { typeId: 'order', id: orderId },
      };

      const mockCart = {
        id: 'cart-123',
        custom: {
          fields: {
            [ORDER_TAX_FIELD_NAMES.CALCULATION_REFERENCES]: ['calc_123'],
          },
        },
      };

      mockRequest.body = {
        message: {
          data: encodedMessage,
        },
      };

      decodeToJson.mockReturnValue(decodedMessage);
      doValidation.mockImplementation(() => {});
      getCartByOrderId.mockResolvedValue(mockCart);
      createTaxTransaction.mockResolvedValue([]);

      await syncHandler(mockRequest, mockResponse);

      expect(createTaxTransaction).toHaveBeenCalledWith(orderId, mockCart);
      expect(updateOrderTaxTxn).not.toHaveBeenCalled();
      expect(responseStatusSpy).toHaveBeenCalledWith(HTTP_STATUS_SUCCESS_NO_CONTENT);
    });

    it('should handle errors from Stripe tax transaction creation', async () => {
      const encodedMessage = 'encoded-base64-string';
      const orderId = 'order-123';
      const decodedMessage = {
        notificationType: 'Message',
        type: 'OrderCreated',
        resource: { typeId: 'order', id: orderId },
      };

      const mockCart = {
        id: 'cart-123',
        custom: {
          fields: {
            [ORDER_TAX_FIELD_NAMES.CALCULATION_REFERENCES]: ['calc_123'],
          },
        },
      };

      mockRequest.body = {
        message: {
          data: encodedMessage,
        },
      };

      decodeToJson.mockReturnValue(decodedMessage);
      doValidation.mockImplementation(() => {});
      getCartByOrderId.mockResolvedValue(mockCart);

      const stripeError = new Error('Stripe API error');
      createTaxTransaction.mockRejectedValue(stripeError);

      await syncHandler(mockRequest, mockResponse);

      expect(createTaxTransaction).toHaveBeenCalledWith(orderId, mockCart);
      expect(updateOrderTaxTxn).not.toHaveBeenCalled();
      expect(responseStatusSpy).toHaveBeenCalledWith(HTTP_STATUS_SUCCESS_ACCEPTED);
      expect(logger.error).toHaveBeenCalled();
    });

    it('should handle CustomError from Stripe tax transaction creation', async () => {
      const encodedMessage = 'encoded-base64-string';
      const orderId = 'order-123';
      const decodedMessage = {
        notificationType: 'Message',
        type: 'OrderCreated',
        resource: { typeId: 'order', id: orderId },
      };

      const mockCart = {
        id: 'cart-123',
        custom: {
          fields: {
            [ORDER_TAX_FIELD_NAMES.CALCULATION_REFERENCES]: ['calc_123'],
          },
        },
      };

      mockRequest.body = {
        message: {
          data: encodedMessage,
        },
      };

      decodeToJson.mockReturnValue(decodedMessage);
      doValidation.mockImplementation(() => {});
      getCartByOrderId.mockResolvedValue(mockCart);

      const stripeError = new CustomError(
        HTTP_STATUS_SUCCESS_ACCEPTED,
        'Error from extension : Missing calculation references.'
      );
      createTaxTransaction.mockRejectedValue(stripeError);

      await syncHandler(mockRequest, mockResponse);

      expect(responseStatusSpy).toHaveBeenCalledWith(HTTP_STATUS_SUCCESS_ACCEPTED);
      expect(logger.error).toHaveBeenCalled();
    });

    it('should handle errors when updating order with tax transactions', async () => {
      const encodedMessage = 'encoded-base64-string';
      const orderId = 'order-123';
      const decodedMessage = {
        notificationType: 'Message',
        type: 'OrderCreated',
        resource: { typeId: 'order', id: orderId },
      };

      const mockCart = {
        id: 'cart-123',
        custom: {
          fields: {
            [ORDER_TAX_FIELD_NAMES.CALCULATION_REFERENCES]: ['calc_123'],
          },
        },
      };

      const mockTaxTransactions = [{ id: 'txn_123' }];

      mockRequest.body = {
        message: {
          data: encodedMessage,
        },
      };

      decodeToJson.mockReturnValue(decodedMessage);
      doValidation.mockImplementation(() => {});
      getCartByOrderId.mockResolvedValue(mockCart);
      createTaxTransaction.mockResolvedValue(mockTaxTransactions);

      const updateError = new CustomError(
        HTTP_STATUS_SUCCESS_ACCEPTED,
        'Update failed'
      );
      updateOrderTaxTxn.mockRejectedValue(updateError);

      await syncHandler(mockRequest, mockResponse);

      expect(createTaxTransaction).toHaveBeenCalledWith(orderId, mockCart);
      expect(updateOrderTaxTxn).toHaveBeenCalledWith(mockTaxTransactions, orderId);
      expect(responseStatusSpy).toHaveBeenCalledWith(HTTP_STATUS_SUCCESS_ACCEPTED);
      expect(logger.error).toHaveBeenCalled();
    });

    it('should handle generic errors with 500 status', async () => {
      const encodedMessage = 'encoded-base64-string';
      const decodedMessage = {
        notificationType: 'Message',
        type: 'OrderCreated',
        resource: { typeId: 'order', id: 'order-123' },
      };

      mockRequest.body = {
        message: {
          data: encodedMessage,
        },
      };

      decodeToJson.mockReturnValue(decodedMessage);
      doValidation.mockImplementation(() => {});

      const genericError = new Error('Unexpected error');
      getCartByOrderId.mockRejectedValue(genericError);

      await syncHandler(mockRequest, mockResponse);

      expect(responseStatusSpy).toHaveBeenCalledWith(HTTP_STATUS_SERVER_ERROR);
      expect(logger.error).toHaveBeenCalled();
    });
  });
});
