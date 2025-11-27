import { expect, describe, it, jest, beforeEach } from '@jest/globals';
import { updateOrderTaxTxn } from '../../../src/clients/update.client.js';
import CustomError from '../../../src/errors/custom.error.js';
import { HTTP_STATUS_SUCCESS_ACCEPTED } from '../../../src/constants/http.status.constants.js';
import { ORDER_TAX_FIELD_NAMES } from '../../../src/connectors/customTypes.js';

// Mock dependencies
jest.mock('../../../src/clients/create.client.js', () => ({
  createApiRoot: jest.fn(),
}));

jest.mock('../../../src/clients/query.client.js', () => ({
  getOrder: jest.fn(),
}));

import { createApiRoot } from '../../../src/clients/create.client.js';
import { getOrder } from '../../../src/clients/query.client.js';

describe('update.client.spec', () => {
  let mockApiRoot;

  beforeEach(() => {
    jest.clearAllMocks();
    mockApiRoot = {
      orders: jest.fn(),
    };
    createApiRoot.mockReturnValue(mockApiRoot);
  });

  describe('updateOrderTaxTxn', () => {
    it('should update order with tax transaction references', async () => {
      const orderId = 'order-123';
      const taxTransactions = [
        { id: 'txn_123' },
        { id: 'txn_456' },
      ];
      const mockOrder = {
        id: orderId,
        version: 5,
      };

      const mockUpdateResponse = {
        body: {
          id: orderId,
          version: 6,
        },
      };

      getOrder.mockResolvedValue(mockOrder);

      const mockOrderRequest = {
        withId: jest.fn().mockReturnThis(),
        post: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue(mockUpdateResponse),
      };

      mockApiRoot.orders.mockReturnValue(mockOrderRequest);
      mockOrderRequest.withId.mockReturnValue(mockOrderRequest);

      const result = await updateOrderTaxTxn(taxTransactions, orderId);

      expect(getOrder).toHaveBeenCalledWith(orderId);
      expect(mockApiRoot.orders).toHaveBeenCalled();
      expect(mockOrderRequest.withId).toHaveBeenCalledWith({ ID: orderId });
      expect(mockOrderRequest.post).toHaveBeenCalledWith({
        body: {
          actions: [
            {
              action: 'setCustomField',
              name: ORDER_TAX_FIELD_NAMES.TRANSACTION_REFERENCES,
              value: ['txn_123', 'txn_456'],
            },
          ],
          version: mockOrder.version,
        },
      });
      expect(result).toEqual(mockUpdateResponse);
    });

    it('should handle single tax transaction', async () => {
      const orderId = 'order-123';
      const taxTransactions = [{ id: 'txn_123' }];
      const mockOrder = {
        id: orderId,
        version: 3,
      };

      const mockUpdateResponse = {
        body: {
          id: orderId,
          version: 4,
        },
      };

      getOrder.mockResolvedValue(mockOrder);

      const mockOrderRequest = {
        withId: jest.fn().mockReturnThis(),
        post: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue(mockUpdateResponse),
      };

      mockApiRoot.orders.mockReturnValue(mockOrderRequest);
      mockOrderRequest.withId.mockReturnValue(mockOrderRequest);

      await updateOrderTaxTxn(taxTransactions, orderId);

      expect(mockOrderRequest.post).toHaveBeenCalledWith({
        body: {
          actions: [
            {
              action: 'setCustomField',
              name: ORDER_TAX_FIELD_NAMES.TRANSACTION_REFERENCES,
              value: ['txn_123'],
            },
          ],
          version: mockOrder.version,
        },
      });
    });

    it('should handle empty tax transactions array', async () => {
      const orderId = 'order-123';
      const taxTransactions = [];
      const mockOrder = {
        id: orderId,
        version: 2,
      };

      getOrder.mockResolvedValue(mockOrder);

      const mockOrderRequest = {
        withId: jest.fn().mockReturnThis(),
        post: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ body: {} }),
      };

      mockApiRoot.orders.mockReturnValue(mockOrderRequest);
      mockOrderRequest.withId.mockReturnValue(mockOrderRequest);

      await updateOrderTaxTxn(taxTransactions, orderId);

      expect(mockOrderRequest.post).toHaveBeenCalledWith({
        body: {
          actions: [
            {
              action: 'setCustomField',
              name: ORDER_TAX_FIELD_NAMES.TRANSACTION_REFERENCES,
              value: [],
            },
          ],
          version: mockOrder.version,
        },
      });
    });

    it('should throw CustomError when update API call fails', async () => {
      const orderId = 'order-123';
      const taxTransactions = [{ id: 'txn_123' }];
      const mockOrder = {
        id: orderId,
        version: 1,
      };
      const apiError = new Error('Update failed');

      getOrder.mockResolvedValue(mockOrder);

      const mockOrderRequest = {
        withId: jest.fn().mockReturnThis(),
        post: jest.fn().mockReturnThis(),
        execute: jest.fn().mockRejectedValue(apiError),
      };

      mockApiRoot.orders.mockReturnValue(mockOrderRequest);
      mockOrderRequest.withId.mockReturnValue(mockOrderRequest);

      await expect(updateOrderTaxTxn(taxTransactions, orderId)).rejects.toThrow();

      try {
        await updateOrderTaxTxn(taxTransactions, orderId);
      } catch (error) {
        expect(error).toBeInstanceOf(CustomError);
        expect(error.statusCode).toBe(HTTP_STATUS_SUCCESS_ACCEPTED);
        expect(error.message).toBe(apiError.message);
      }
    });

    it('should throw CustomError when getOrder fails', async () => {
      const orderId = 'order-123';
      const taxTransactions = [{ id: 'txn_123' }];
      const apiError = new Error('Order not found');

      getOrder.mockRejectedValue(apiError);

      await expect(updateOrderTaxTxn(taxTransactions, orderId)).rejects.toThrow();
    });
  });
});

