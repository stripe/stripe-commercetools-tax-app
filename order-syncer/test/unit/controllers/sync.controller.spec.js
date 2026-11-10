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
  retrieveCalculation: jest.fn(),
}));

jest.mock('../../../src/validators/calculation-binding.validators.js', () => ({
  partitionReferencesByOrderBinding: jest.fn(),
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
import { partitionReferencesByOrderBinding } from '../../../src/validators/calculation-binding.validators.js';

describe('sync.controller.spec', () => {
  let mockRequest;
  let mockResponse;
  let responseStatusSpy;
  let responseSendSpy;

  beforeEach(() => {
    jest.clearAllMocks();

    // Default: every stored reference belongs to the order (binding is tested in its own spec).
    partitionReferencesByOrderBinding.mockImplementation(async (refs) => ({ valid: refs, invalid: [] }));

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

  describe('syncHandler - calculation reference binding (SB3-238 AC-5)', () => {
    const orderId = 'order-123';
    const paymentIntentId = 'pi_123';

    const orderWith = (refs) => ({
      id: orderId,
      custom: { fields: { [ORDER_TAX_FIELD_NAMES.CALCULATION_REFERENCES]: refs } },
      paymentInfo: { payments: [{ obj: { interfaceId: paymentIntentId } }] },
    });

    beforeEach(() => {
      mockRequest.body = { message: { data: 'encoded-base64-string' } };
      decodeToJson.mockReturnValue({
        notificationType: 'Message',
        type: 'OrderCreated',
        resource: { typeId: 'order', id: orderId },
      });
      doValidation.mockImplementation(() => {});
    });

    it('files only the references that belong to the order and flags the foreign one', async () => {
      getOrderWithPaymentInfo.mockResolvedValue(orderWith(['calc_mine', 'calc_foreign']));
      partitionReferencesByOrderBinding.mockResolvedValue({
        valid: ['calc_mine'],
        invalid: [{ ref: 'calc_foreign', reason: 'cartId-mismatch' }],
      });
      getTransactionFromTaxCalculation.mockResolvedValue({ id: 'tax_mine' });
      updateOrderTaxTxn.mockResolvedValue({ body: {} });

      await syncHandler(mockRequest, mockResponse);

      // One valid reference → single-calc path, foreign one never filed.
      expect(getTransactionFromTaxCalculation).toHaveBeenCalledWith('calc_mine', orderId, paymentIntentId);
      expect(createTaxTransactions).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('calc_foreign'));
    });

    it('files nothing and logs an error when no reference belongs to the order', async () => {
      getOrderWithPaymentInfo.mockResolvedValue(orderWith(['calc_foreign']));
      partitionReferencesByOrderBinding.mockResolvedValue({
        valid: [],
        invalid: [{ ref: 'calc_foreign', reason: 'address-mismatch' }],
      });

      await syncHandler(mockRequest, mockResponse);

      expect(getTransactionFromTaxCalculation).not.toHaveBeenCalled();
      expect(createTaxTransactions).not.toHaveBeenCalled();
      expect(updateOrderTaxTxn).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalled();
      // Message is acknowledged (no throw → no redelivery loop).
      expect(responseStatusSpy).toHaveBeenCalledWith(HTTP_STATUS_SUCCESS_NO_CONTENT);
    });

    it.each([
      ['the provider status (5xx)', Object.assign(new Error('Service unavailable'), { statusCode: 503 }), 503],
      ['the provider status (429)', Object.assign(new Error('Too many requests'), { statusCode: 429 }), 429],
      ['500 when the failure has no status (network)', new Error('socket hang up'), HTTP_STATUS_SERVER_ERROR],
    ])('answers %s and files nothing when checking a reference fails transiently, so Pub/Sub redelivers', async (_name, error, status) => {
      getOrderWithPaymentInfo.mockResolvedValue(orderWith(['calc_mine', 'calc_other']));
      partitionReferencesByOrderBinding.mockRejectedValue(error);

      await syncHandler(mockRequest, mockResponse);

      expect(getTransactionFromTaxCalculation).not.toHaveBeenCalled();
      expect(createTaxTransactions).not.toHaveBeenCalled();
      expect(updateOrderTaxTxn).not.toHaveBeenCalled();
      expect(responseStatusSpy).toHaveBeenCalledWith(status);
      expect(responseStatusSpy).not.toHaveBeenCalledWith(HTTP_STATUS_SUCCESS_NO_CONTENT);
      expect(responseStatusSpy).not.toHaveBeenCalledWith(HTTP_STATUS_SUCCESS_ACCEPTED);
    });

    // SB3-238 round 4: the list is shopper-written. Above the bound nothing is retrieved, so a rate
    // limit cannot make Pub/Sub redeliver an unbounded list; the sale is logged for manual filing.
    it('checks and files nothing, and logs an error, when an order carries more references than the bound', async () => {
      const refs = Array.from({ length: 101 }, (_, i) => `calc_${i}`);
      getOrderWithPaymentInfo.mockResolvedValue(orderWith(refs));

      await syncHandler(mockRequest, mockResponse);

      expect(partitionReferencesByOrderBinding).not.toHaveBeenCalled();
      expect(getTransactionFromTaxCalculation).not.toHaveBeenCalled();
      expect(createTaxTransactions).not.toHaveBeenCalled();
      expect(updateOrderTaxTxn).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('101 calculation references exceed the bound of 100'));
      expect(responseStatusSpy).toHaveBeenCalledWith(HTTP_STATUS_SUCCESS_NO_CONTENT);
    });

    it('removes repeated ids before applying the bound', async () => {
      const unique = Array.from({ length: 100 }, (_, i) => `calc_${i}`);
      getOrderWithPaymentInfo.mockResolvedValue(orderWith([...unique, 'calc_0'])); // 101 entries, 100 distinct
      createTaxTransactions.mockResolvedValue([]);
      updateOrderTaxTxn.mockResolvedValue({ body: {} });

      await syncHandler(mockRequest, mockResponse);

      expect(partitionReferencesByOrderBinding).toHaveBeenCalledWith(unique, expect.anything());
      expect(logger.error).not.toHaveBeenCalledWith(expect.stringContaining('exceed the bound'));
    });

    it('still checks an order carrying exactly the bound of references', async () => {
      const refs = Array.from({ length: 100 }, (_, i) => `calc_${i}`);
      getOrderWithPaymentInfo.mockResolvedValue(orderWith(refs));
      createTaxTransactions.mockResolvedValue([]);
      updateOrderTaxTxn.mockResolvedValue({ body: {} });

      await syncHandler(mockRequest, mockResponse);

      expect(partitionReferencesByOrderBinding).toHaveBeenCalledWith(refs, expect.anything());
    });

    // SB3-238 round 4: a repeated id would be filed twice; the provider refuses the second (a
    // reference is unique), the message redelivers and fails again at the same place, forever.
    it('files a repeated reference once', async () => {
      getOrderWithPaymentInfo.mockResolvedValue(orderWith(['calc_a', 'calc_a']));
      getTransactionFromTaxCalculation.mockResolvedValue({ id: 'tax_a' });
      updateOrderTaxTxn.mockResolvedValue({ body: {} });

      await syncHandler(mockRequest, mockResponse);

      expect(partitionReferencesByOrderBinding).toHaveBeenCalledWith(['calc_a'], expect.anything());
      expect(createTaxTransactions).not.toHaveBeenCalled();
      expect(getTransactionFromTaxCalculation).toHaveBeenCalledTimes(1);
      expect(getTransactionFromTaxCalculation).toHaveBeenCalledWith('calc_a', orderId, paymentIntentId);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('1 repeated calculation reference(s) dropped'));
    });

    it('logs an error (not a silent skip) when a paid order has an emptied reference list', async () => {
      getOrderWithPaymentInfo.mockResolvedValue(orderWith([]));

      await syncHandler(mockRequest, mockResponse);

      expect(partitionReferencesByOrderBinding).not.toHaveBeenCalled();
      expect(createTaxTransactions).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalled();
      expect(responseStatusSpy).toHaveBeenCalledWith(HTTP_STATUS_SUCCESS_NO_CONTENT);
    });
  });
});
