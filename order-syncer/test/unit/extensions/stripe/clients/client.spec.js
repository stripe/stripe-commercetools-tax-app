import { expect, describe, it, jest, beforeEach, afterEach } from '@jest/globals';
import createTaxTransaction from '../../../../../src/extensions/stripe/clients/client.js';
import { ORDER_TAX_FIELD_NAMES } from '../../../../../src/connectors/customTypes.js';

// Mock Stripe
const mockStripeClient = {
  tax: {
    transactions: {
      createFromCalculation: jest.fn(),
    },
  },
};

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => mockStripeClient);
});

jest.mock('../../../../../src/extensions/stripe/configurations/config.js', () => ({
  loadConfig: jest.fn(() => ({
    taxProviderApiToken: 'sk_test_mock_token',
  })),
}));

describe('stripe-client.spec', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createTaxTransaction', () => {
    it('should create tax transaction from calculation reference', async () => {
      const orderId = 'order-123';
      const calculationReference = 'calc_123';
      const cart = {
        custom: {
          fields: {
            [ORDER_TAX_FIELD_NAMES.CALCULATION_REFERENCES]: [calculationReference],
          },
        },
      };

      const mockTransaction = {
        id: 'txn_123',
        calculation: calculationReference,
        reference: orderId,
      };

      mockStripeClient.tax.transactions.createFromCalculation.mockResolvedValue(mockTransaction);

      const result = await createTaxTransaction(orderId, cart);

      expect(mockStripeClient.tax.transactions.createFromCalculation).toHaveBeenCalledWith({
        calculation: calculationReference,
        reference: orderId,
        metadata: {
          ct_order_id: orderId,
        },
      });
      expect(result).toEqual([mockTransaction]);
    });

    it('should create multiple tax transactions from multiple calculation references', async () => {
      const orderId = 'order-123';
      const calculationReferences = ['calc_123', 'calc_456'];
      const cart = {
        custom: {
          fields: {
            [ORDER_TAX_FIELD_NAMES.CALCULATION_REFERENCES]: calculationReferences,
          },
        },
      };

      const mockTransactions = [
        { id: 'txn_123', calculation: 'calc_123', reference: orderId },
        { id: 'txn_456', calculation: 'calc_456', reference: orderId },
      ];

      mockStripeClient.tax.transactions.createFromCalculation
        .mockResolvedValueOnce(mockTransactions[0])
        .mockResolvedValueOnce(mockTransactions[1]);

      const result = await createTaxTransaction(orderId, cart);

      expect(mockStripeClient.tax.transactions.createFromCalculation).toHaveBeenCalledTimes(2);
      expect(result).toEqual(mockTransactions);
      expect(result).toHaveLength(2);
    });

    it('should throw error when calculation references are missing', async () => {
      const orderId = 'order-123';
      const cart = {
        custom: {
          fields: {},
        },
      };

      await expect(createTaxTransaction(orderId, cart)).rejects.toThrow('Missing calculation references');
    });

    it('should throw error when calculation references is null', async () => {
      const orderId = 'order-123';
      const cart = {
        custom: {
          fields: {
            [ORDER_TAX_FIELD_NAMES.CALCULATION_REFERENCES]: null,
          },
        },
      };

      await expect(createTaxTransaction(orderId, cart)).rejects.toThrow('Missing calculation references');
    });

    it('should throw error when calculation references is undefined', async () => {
      const orderId = 'order-123';
      const cart = {
        custom: {
          fields: {
            [ORDER_TAX_FIELD_NAMES.CALCULATION_REFERENCES]: undefined,
          },
        },
      };

      await expect(createTaxTransaction(orderId, cart)).rejects.toThrow('Missing calculation references');
    });

    it('should throw error when calculation references is not an array', async () => {
      const orderId = 'order-123';
      const cart = {
        custom: {
          fields: {
            [ORDER_TAX_FIELD_NAMES.CALCULATION_REFERENCES]: 'not-an-array',
          },
        },
      };

      await expect(createTaxTransaction(orderId, cart)).rejects.toThrow('Missing calculation references');
    });

    it('should throw error when calculation references is empty array', async () => {
      const orderId = 'order-123';
      const cart = {
        custom: {
          fields: {
            [ORDER_TAX_FIELD_NAMES.CALCULATION_REFERENCES]: [],
          },
        },
      };

      await expect(createTaxTransaction(orderId, cart)).rejects.toThrow('Missing calculation references');
    });

    it('should throw error when cart.custom is missing', async () => {
      const orderId = 'order-123';
      const cart = {};

      await expect(createTaxTransaction(orderId, cart)).rejects.toThrow('Missing calculation references');
    });

    it('should throw error when cart.custom.fields is missing', async () => {
      const orderId = 'order-123';
      const cart = {
        custom: {},
      };

      await expect(createTaxTransaction(orderId, cart)).rejects.toThrow('Missing calculation references');
    });

    it('should propagate Stripe API errors', async () => {
      const orderId = 'order-123';
      const calculationReference = 'calc_123';
      const cart = {
        custom: {
          fields: {
            [ORDER_TAX_FIELD_NAMES.CALCULATION_REFERENCES]: [calculationReference],
          },
        },
      };

      const stripeError = new Error('Stripe API error');
      mockStripeClient.tax.transactions.createFromCalculation.mockRejectedValue(stripeError);

      await expect(createTaxTransaction(orderId, cart)).rejects.toThrow('Stripe API error');
    });

    it('should reuse the same Stripe client instance on multiple calls', async () => {
      const orderId1 = 'order-123';
      const orderId2 = 'order-456';
      const calculationReference = 'calc_123';
      const cart = {
        custom: {
          fields: {
            [ORDER_TAX_FIELD_NAMES.CALCULATION_REFERENCES]: [calculationReference],
          },
        },
      };

      const mockTransaction = { id: 'txn_123' };
      mockStripeClient.tax.transactions.createFromCalculation.mockResolvedValue(mockTransaction);

      await createTaxTransaction(orderId1, cart);
      await createTaxTransaction(orderId2, cart);

      // Stripe should be instantiated once, but createFromCalculation called twice
      expect(mockStripeClient.tax.transactions.createFromCalculation).toHaveBeenCalledTimes(2);
    });
  });
});

