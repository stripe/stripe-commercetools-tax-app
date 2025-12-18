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
    warn: jest.fn(),
  },
}));

jest.mock('../../../src/utils/decoder.util.js', () => ({
  decodeToJson: jest.fn(),
}));

jest.mock('../../../src/validators/order-change.validators.js', () => ({
  doValidation: jest.fn(),
}));

jest.mock('../../../src/clients/query.client.js', () => ({
  getOrderWithPaymentInfo: jest.fn(),
}));

jest.mock('../../../src/clients/update.client.js', () => ({
  updateOrderTaxTxn: jest.fn(),
}));

jest.mock('../../../src/extensions/stripe/clients/client.js', () => ({
  createTaxTransactions: jest.fn(),
  getTransactionFromTaxCalculation: jest.fn(),
  updatePaymentIntentMetadata: jest.fn(),
}));

import { logger } from '../../../src/utils/logger.util.js';
import { decodeToJson } from '../../../src/utils/decoder.util.js';
import { doValidation } from '../../../src/validators/order-change.validators.js';
import { getOrderWithPaymentInfo } from '../../../src/clients/query.client.js';
import { updateOrderTaxTxn } from '../../../src/clients/update.client.js';
import { 
  createTaxTransactions, 
  getTransactionFromTaxCalculation, 
  updatePaymentIntentMetadata 
} from '../../../src/extensions/stripe/clients/client.js';

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

  describe('syncHandler - Order retrieval', () => {
    it('should return 204 when order has no calculation references', async () => {
      const encodedMessage = 'encoded-base64-string';
      const decodedMessage = {
        notificationType: 'Message',
        type: 'OrderCreated',
        resource: { typeId: 'order', id: 'order-123' },
      };

      const mockOrder = {
        id: 'order-123',
        custom: {
          fields: {
            [ORDER_TAX_FIELD_NAMES.CALCULATION_REFERENCES]: [],
          },
        },
        paymentInfo: {
          payments: [{ obj: { interfaceId: 'pi_123' } }],
        },
      };

      mockRequest.body = {
        message: {
          data: encodedMessage,
        },
      };

      decodeToJson.mockReturnValue(decodedMessage);
      doValidation.mockImplementation(() => {});
      getOrderWithPaymentInfo.mockResolvedValue(mockOrder);

      await syncHandler(mockRequest, mockResponse);

      expect(getOrderWithPaymentInfo).toHaveBeenCalledWith('order-123');
      expect(responseStatusSpy).toHaveBeenCalledWith(HTTP_STATUS_SUCCESS_NO_CONTENT);
      expect(responseSendSpy).toHaveBeenCalled();
      expect(createTaxTransactions).not.toHaveBeenCalled();
      expect(getTransactionFromTaxCalculation).not.toHaveBeenCalled();
    });

    it('should handle errors when retrieving order', async () => {
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

      const orderError = new CustomError(
        HTTP_STATUS_SUCCESS_ACCEPTED,
        'Order not found'
      );
      getOrderWithPaymentInfo.mockRejectedValue(orderError);

      await syncHandler(mockRequest, mockResponse);

      expect(getOrderWithPaymentInfo).toHaveBeenCalledWith('order-123');
      expect(responseStatusSpy).toHaveBeenCalledWith(HTTP_STATUS_SUCCESS_ACCEPTED);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('syncHandler - Single calculation reference', () => {
    it('should call getTransactionFromTaxCalculation for single calculation reference', async () => {
      const encodedMessage = 'encoded-base64-string';
      const orderId = 'order-123';
      const calcRef = 'calc_123';
      const paymentIntentId = 'pi_123';
      const decodedMessage = {
        notificationType: 'Message',
        type: 'OrderCreated',
        resource: { typeId: 'order', id: orderId },
      };

      const mockOrder = {
        id: orderId,
        custom: {
          fields: {
            [ORDER_TAX_FIELD_NAMES.CALCULATION_REFERENCES]: [calcRef],
          },
        },
        paymentInfo: {
          payments: [{ obj: { interfaceId: paymentIntentId } }],
        },
      };

      const mockTransaction = { id: 'tax_123' };

      mockRequest.body = {
        message: {
          data: encodedMessage,
        },
      };

      decodeToJson.mockReturnValue(decodedMessage);
      doValidation.mockImplementation(() => {});
      getOrderWithPaymentInfo.mockResolvedValue(mockOrder);
      getTransactionFromTaxCalculation.mockResolvedValue(mockTransaction);
      updateOrderTaxTxn.mockResolvedValue({ body: {} });
      updatePaymentIntentMetadata.mockResolvedValue();

      await syncHandler(mockRequest, mockResponse);

      expect(getOrderWithPaymentInfo).toHaveBeenCalledWith(orderId);
      expect(getTransactionFromTaxCalculation).toHaveBeenCalledWith(calcRef, orderId, paymentIntentId);
      expect(updateOrderTaxTxn).toHaveBeenCalledWith([mockTransaction], orderId);
      expect(updatePaymentIntentMetadata).toHaveBeenCalledWith(paymentIntentId, ['tax_123']);
      expect(responseStatusSpy).toHaveBeenCalledWith(HTTP_STATUS_SUCCESS_NO_CONTENT);
    });

    it('should not update order when transaction has no id', async () => {
      const encodedMessage = 'encoded-base64-string';
      const orderId = 'order-123';
      const calcRef = 'calc_123';
      const paymentIntentId = 'pi_123';
      const decodedMessage = {
        notificationType: 'Message',
        type: 'OrderCreated',
        resource: { typeId: 'order', id: orderId },
      };

      const mockOrder = {
        id: orderId,
        custom: {
          fields: {
            [ORDER_TAX_FIELD_NAMES.CALCULATION_REFERENCES]: [calcRef],
          },
        },
        paymentInfo: {
          payments: [{ obj: { interfaceId: paymentIntentId } }],
        },
      };

      // Transaction without id
      const mockTransaction = {};

      mockRequest.body = {
        message: {
          data: encodedMessage,
        },
      };

      decodeToJson.mockReturnValue(decodedMessage);
      doValidation.mockImplementation(() => {});
      getOrderWithPaymentInfo.mockResolvedValue(mockOrder);
      getTransactionFromTaxCalculation.mockResolvedValue(mockTransaction);

      await syncHandler(mockRequest, mockResponse);

      expect(getTransactionFromTaxCalculation).toHaveBeenCalledWith(calcRef, orderId, paymentIntentId);
      expect(updateOrderTaxTxn).not.toHaveBeenCalled();
      expect(updatePaymentIntentMetadata).not.toHaveBeenCalled();
      expect(responseStatusSpy).toHaveBeenCalledWith(HTTP_STATUS_SUCCESS_NO_CONTENT);
    });
  });

  describe('syncHandler - Multiple calculation references', () => {
    it('should call createTaxTransactions for multiple calculation references', async () => {
      const encodedMessage = 'encoded-base64-string';
      const orderId = 'order-123';
      const calcRefs = ['calc_123', 'calc_456'];
      const paymentIntentId = 'pi_123';
      const decodedMessage = {
        notificationType: 'Message',
        type: 'OrderCreated',
        resource: { typeId: 'order', id: orderId },
      };

      const mockOrder = {
        id: orderId,
        custom: {
          fields: {
            [ORDER_TAX_FIELD_NAMES.CALCULATION_REFERENCES]: calcRefs,
          },
        },
        paymentInfo: {
          payments: [{ obj: { interfaceId: paymentIntentId } }],
        },
      };

      const mockTaxTransactions = [
        { id: 'tax_123' },
        { id: 'tax_456' },
      ];

      mockRequest.body = {
        message: {
          data: encodedMessage,
        },
      };

      decodeToJson.mockReturnValue(decodedMessage);
      doValidation.mockImplementation(() => {});
      getOrderWithPaymentInfo.mockResolvedValue(mockOrder);
      createTaxTransactions.mockResolvedValue(mockTaxTransactions);
      updateOrderTaxTxn.mockResolvedValue({ body: {} });
      updatePaymentIntentMetadata.mockResolvedValue();

      await syncHandler(mockRequest, mockResponse);

      expect(getOrderWithPaymentInfo).toHaveBeenCalledWith(orderId);
      expect(createTaxTransactions).toHaveBeenCalledWith(orderId, calcRefs, paymentIntentId);
      expect(updateOrderTaxTxn).toHaveBeenCalledWith(mockTaxTransactions, orderId);
      expect(updatePaymentIntentMetadata).toHaveBeenCalledWith(paymentIntentId, ['tax_123', 'tax_456']);
      expect(responseStatusSpy).toHaveBeenCalledWith(HTTP_STATUS_SUCCESS_NO_CONTENT);
    });

    it('should handle errors from Stripe createTaxTransactions', async () => {
      const encodedMessage = 'encoded-base64-string';
      const orderId = 'order-123';
      const calcRefs = ['calc_123', 'calc_456'];
      const paymentIntentId = 'pi_123';
      const decodedMessage = {
        notificationType: 'Message',
        type: 'OrderCreated',
        resource: { typeId: 'order', id: orderId },
      };

      const mockOrder = {
        id: orderId,
        custom: {
          fields: {
            [ORDER_TAX_FIELD_NAMES.CALCULATION_REFERENCES]: calcRefs,
          },
        },
        paymentInfo: {
          payments: [{ obj: { interfaceId: paymentIntentId } }],
        },
      };

      mockRequest.body = {
        message: {
          data: encodedMessage,
        },
      };

      decodeToJson.mockReturnValue(decodedMessage);
      doValidation.mockImplementation(() => {});
      getOrderWithPaymentInfo.mockResolvedValue(mockOrder);

      const stripeError = new Error('Stripe API error');
      createTaxTransactions.mockRejectedValue(stripeError);

      await syncHandler(mockRequest, mockResponse);

      expect(createTaxTransactions).toHaveBeenCalledWith(orderId, calcRefs, paymentIntentId);
      expect(updateOrderTaxTxn).not.toHaveBeenCalled();
      expect(responseStatusSpy).toHaveBeenCalledWith(HTTP_STATUS_SERVER_ERROR);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('syncHandler - Error handling', () => {
    it('should handle errors when updating order with tax transactions', async () => {
      const encodedMessage = 'encoded-base64-string';
      const orderId = 'order-123';
      const calcRefs = ['calc_123', 'calc_456'];
      const paymentIntentId = 'pi_123';
      const decodedMessage = {
        notificationType: 'Message',
        type: 'OrderCreated',
        resource: { typeId: 'order', id: orderId },
      };

      const mockOrder = {
        id: orderId,
        custom: {
          fields: {
            [ORDER_TAX_FIELD_NAMES.CALCULATION_REFERENCES]: calcRefs,
          },
        },
        paymentInfo: {
          payments: [{ obj: { interfaceId: paymentIntentId } }],
        },
      };

      const mockTaxTransactions = [{ id: 'tax_123' }];

      mockRequest.body = {
        message: {
          data: encodedMessage,
        },
      };

      decodeToJson.mockReturnValue(decodedMessage);
      doValidation.mockImplementation(() => {});
      getOrderWithPaymentInfo.mockResolvedValue(mockOrder);
      createTaxTransactions.mockResolvedValue(mockTaxTransactions);

      const updateError = new CustomError(
        HTTP_STATUS_SUCCESS_ACCEPTED,
        'Update failed'
      );
      updateOrderTaxTxn.mockRejectedValue(updateError);

      await syncHandler(mockRequest, mockResponse);

      expect(createTaxTransactions).toHaveBeenCalledWith(orderId, calcRefs, paymentIntentId);
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
      getOrderWithPaymentInfo.mockRejectedValue(genericError);

      await syncHandler(mockRequest, mockResponse);

      expect(responseStatusSpy).toHaveBeenCalledWith(HTTP_STATUS_SERVER_ERROR);
      expect(logger.error).toHaveBeenCalled();
    });

    it('should not call updatePaymentIntentMetadata when paymentIntentId is missing', async () => {
      const encodedMessage = 'encoded-base64-string';
      const orderId = 'order-123';
      const calcRef = 'calc_123';
      const decodedMessage = {
        notificationType: 'Message',
        type: 'OrderCreated',
        resource: { typeId: 'order', id: orderId },
      };

      const mockOrder = {
        id: orderId,
        custom: {
          fields: {
            [ORDER_TAX_FIELD_NAMES.CALCULATION_REFERENCES]: [calcRef],
          },
        },
        paymentInfo: {
          payments: [{ obj: {} }], // No interfaceId
        },
      };

      const mockTransaction = { id: 'tax_123' };

      mockRequest.body = {
        message: {
          data: encodedMessage,
        },
      };

      decodeToJson.mockReturnValue(decodedMessage);
      doValidation.mockImplementation(() => {});
      getOrderWithPaymentInfo.mockResolvedValue(mockOrder);
      getTransactionFromTaxCalculation.mockResolvedValue(mockTransaction);
      updateOrderTaxTxn.mockResolvedValue({ body: {} });

      await syncHandler(mockRequest, mockResponse);

      expect(updatePaymentIntentMetadata).not.toHaveBeenCalled();
      expect(responseStatusSpy).toHaveBeenCalledWith(HTTP_STATUS_SUCCESS_NO_CONTENT);
    });
  });
});
