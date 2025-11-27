import { expect, describe, it, jest, beforeEach } from '@jest/globals';
import { getCartByOrderId, getOrder } from '../../../src/clients/query.client.js';
import CustomError from '../../../src/errors/custom.error.js';
import { HTTP_STATUS_SUCCESS_ACCEPTED } from '../../../src/constants/http.status.constants.js';

// Mock dependencies
jest.mock('../../../src/clients/create.client.js', () => ({
  createApiRoot: jest.fn(),
}));

import { createApiRoot } from '../../../src/clients/create.client.js';

describe('query.client.spec', () => {
  let mockApiRoot;

  beforeEach(() => {
    jest.clearAllMocks();
    mockApiRoot = {
      orders: jest.fn(),
    };
    createApiRoot.mockReturnValue(mockApiRoot);
  });

  describe('getCartByOrderId', () => {
    it('should return cart object when order is found', async () => {
      const orderId = 'order-123';
      const mockCart = {
        id: 'cart-123',
        lineItems: [],
        totalPrice: { currencyCode: 'USD', centAmount: 1000 },
      };

      const mockOrderResponse = {
        body: {
          cart: {
            obj: mockCart,
          },
        },
      };

      const mockOrderRequest = {
        withId: jest.fn().mockReturnThis(),
        get: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue(mockOrderResponse),
      };

      mockApiRoot.orders.mockReturnValue(mockOrderRequest);
      mockOrderRequest.withId.mockReturnValue(mockOrderRequest);

      const result = await getCartByOrderId(orderId);

      expect(createApiRoot).toHaveBeenCalled();
      expect(mockApiRoot.orders).toHaveBeenCalled();
      expect(mockOrderRequest.withId).toHaveBeenCalledWith({ ID: orderId });
      expect(mockOrderRequest.get).toHaveBeenCalledWith({
        queryArgs: { withTotal: false, expand: ['cart'] },
      });
      expect(result).toEqual(mockCart);
    });

    it('should return undefined when cart is not found in order', async () => {
      const orderId = 'order-123';
      const mockOrderResponse = {
        body: {
          cart: undefined,
        },
      };

      const mockOrderRequest = {
        withId: jest.fn().mockReturnThis(),
        get: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue(mockOrderResponse),
      };

      mockApiRoot.orders.mockReturnValue(mockOrderRequest);
      mockOrderRequest.withId.mockReturnValue(mockOrderRequest);

      const result = await getCartByOrderId(orderId);

      expect(result).toBeUndefined();
    });

    it('should throw CustomError when API call fails', async () => {
      const orderId = 'order-123';
      const apiError = new Error('Order not found');

      const mockOrderRequest = {
        withId: jest.fn().mockReturnThis(),
        get: jest.fn().mockReturnThis(),
        execute: jest.fn().mockRejectedValue(apiError),
      };

      mockApiRoot.orders.mockReturnValue(mockOrderRequest);
      mockOrderRequest.withId.mockReturnValue(mockOrderRequest);

      await expect(getCartByOrderId(orderId)).rejects.toThrow();

      try {
        await getCartByOrderId(orderId);
      } catch (error) {
        expect(error).toBeInstanceOf(CustomError);
        expect(error.statusCode).toBe(HTTP_STATUS_SUCCESS_ACCEPTED);
        expect(error.message).toBe(apiError.message);
      }
    });
  });

  describe('getOrder', () => {
    it('should return order object when order is found', async () => {
      const orderId = 'order-123';
      const mockOrder = {
        id: orderId,
        version: 1,
        orderState: 'Confirmed',
        totalPrice: { currencyCode: 'USD', centAmount: 1000 },
      };

      const mockOrderResponse = {
        body: mockOrder,
      };

      const mockOrderRequest = {
        withId: jest.fn().mockReturnThis(),
        get: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue(mockOrderResponse),
      };

      mockApiRoot.orders.mockReturnValue(mockOrderRequest);
      mockOrderRequest.withId.mockReturnValue(mockOrderRequest);

      const result = await getOrder(orderId);

      expect(createApiRoot).toHaveBeenCalled();
      expect(mockApiRoot.orders).toHaveBeenCalled();
      expect(mockOrderRequest.withId).toHaveBeenCalledWith({ ID: orderId });
      expect(mockOrderRequest.get).toHaveBeenCalled();
      expect(result).toEqual(mockOrder);
    });

    it('should throw CustomError when API call fails', async () => {
      const orderId = 'order-123';
      const apiError = new Error('Order not found');

      const mockOrderRequest = {
        withId: jest.fn().mockReturnThis(),
        get: jest.fn().mockReturnThis(),
        execute: jest.fn().mockRejectedValue(apiError),
      };

      mockApiRoot.orders.mockReturnValue(mockOrderRequest);
      mockOrderRequest.withId.mockReturnValue(mockOrderRequest);

      await expect(getOrder(orderId)).rejects.toThrow();

      try {
        await getOrder(orderId);
      } catch (error) {
        expect(error).toBeInstanceOf(CustomError);
        expect(error.statusCode).toBe(HTTP_STATUS_SUCCESS_ACCEPTED);
        expect(error.message).toBe(apiError.message);
      }
    });
  });
});

