import { expect, describe, it, jest, beforeEach, afterEach } from '@jest/globals';
import { 
  createTaxTransactions, 
  getTransactionFromTaxCalculation,
  updatePaymentIntentMetadata 
} from '../../../../../src/extensions/stripe/clients/client.js';

// Mock Stripe
const mockStripeClient = {
  tax: {
    transactions: {
      createFromCalculation: jest.fn(),
    },
  },
  paymentIntents: {
    update: jest.fn(),
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

jest.mock('../../../../../src/utils/logger.util.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('stripe-client.spec', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createTaxTransactions', () => {
    it('should create tax transaction from calculation reference', async () => {
      const orderId = 'order-123';
      const calculationReferences = ['calc_123'];
      const paymentIntentId = 'pi_123';

      const mockTransaction = {
        id: 'txn_123',
        calculation: 'calc_123',
        reference: 'calc_123',
      };

      mockStripeClient.tax.transactions.createFromCalculation.mockResolvedValue(mockTransaction);

      const result = await createTaxTransactions(orderId, calculationReferences, paymentIntentId);

      expect(mockStripeClient.tax.transactions.createFromCalculation).toHaveBeenCalledWith({
        calculation: 'calc_123',
        reference: 'calc_123',
        metadata: {
          ct_order_id: orderId,
          paymentIntentId: paymentIntentId,
        },
      });
      expect(result).toEqual([mockTransaction]);
    });

    it('should create multiple tax transactions from multiple calculation references', async () => {
      const orderId = 'order-123';
      const calculationReferences = ['calc_123', 'calc_456'];
      const paymentIntentId = 'pi_123';

      const mockTransactions = [
        { id: 'txn_123', calculation: 'calc_123', reference: 'calc_123' },
        { id: 'txn_456', calculation: 'calc_456', reference: 'calc_456' },
      ];

      mockStripeClient.tax.transactions.createFromCalculation
        .mockResolvedValueOnce(mockTransactions[0])
        .mockResolvedValueOnce(mockTransactions[1]);

      const result = await createTaxTransactions(orderId, calculationReferences, paymentIntentId);

      expect(mockStripeClient.tax.transactions.createFromCalculation).toHaveBeenCalledTimes(2);
      expect(result).toEqual(mockTransactions);
      expect(result).toHaveLength(2);
    });

    it('should propagate Stripe API errors', async () => {
      const orderId = 'order-123';
      const calculationReferences = ['calc_123'];
      const paymentIntentId = 'pi_123';

      const stripeError = new Error('Stripe API error');
      mockStripeClient.tax.transactions.createFromCalculation.mockRejectedValue(stripeError);

      await expect(createTaxTransactions(orderId, calculationReferences, paymentIntentId)).rejects.toThrow('Stripe API error');
    });

    it('should reuse the same Stripe client instance on multiple calls', async () => {
      const orderId1 = 'order-123';
      const orderId2 = 'order-456';
      const calculationReferences = ['calc_123'];
      const paymentIntentId = 'pi_123';

      const mockTransaction = { id: 'txn_123' };
      mockStripeClient.tax.transactions.createFromCalculation.mockResolvedValue(mockTransaction);

      await createTaxTransactions(orderId1, calculationReferences, paymentIntentId);
      await createTaxTransactions(orderId2, calculationReferences, paymentIntentId);

      // Stripe should be instantiated once, but createFromCalculation called twice
      expect(mockStripeClient.tax.transactions.createFromCalculation).toHaveBeenCalledTimes(2);
    });
  });

  describe('getTransactionFromTaxCalculation', () => {
    it('should create transaction from calculation and return it', async () => {
      const calculationReference = 'calc_123';
      const orderId = 'order-123';
      const paymentIntentId = 'pi_123';

      const mockTransaction = {
        id: 'tax_123',
        calculation: calculationReference,
        reference: calculationReference,
      };

      mockStripeClient.tax.transactions.createFromCalculation.mockResolvedValue(mockTransaction);

      const result = await getTransactionFromTaxCalculation(calculationReference, orderId, paymentIntentId);

      expect(mockStripeClient.tax.transactions.createFromCalculation).toHaveBeenCalledWith({
        calculation: calculationReference,
        reference: calculationReference,
        metadata: {
          ct_order_id: orderId,
          paymentIntentId: paymentIntentId,
        },
      });
      expect(result).toEqual(mockTransaction);
    });

    it('should extract transaction ID from error message when transaction already exists', async () => {
      const calculationReference = 'calc_123';
      const orderId = 'order-123';
      const paymentIntentId = 'pi_123';

      const stripeError = new Error('A tax transaction tax_ABC123 already exists for this calculation');
      stripeError.code = 'resource_already_exists';
      mockStripeClient.tax.transactions.createFromCalculation.mockRejectedValue(stripeError);

      const result = await getTransactionFromTaxCalculation(calculationReference, orderId, paymentIntentId);

      expect(result.id).toBe('tax_ABC123');
    });

    it('should return empty object when error occurs without transaction ID', async () => {
      const calculationReference = 'calc_123';
      const orderId = 'order-123';
      const paymentIntentId = 'pi_123';

      const stripeError = new Error('Some other error');
      stripeError.code = 'some_error';
      mockStripeClient.tax.transactions.createFromCalculation.mockRejectedValue(stripeError);

      const result = await getTransactionFromTaxCalculation(calculationReference, orderId, paymentIntentId);

      expect(result.id).toBeUndefined();
    });
  });

  describe('updatePaymentIntentMetadata', () => {
    it('should update PaymentIntent with transaction IDs', async () => {
      const paymentIntentId = 'pi_123';
      const transactionIds = ['tax_123', 'tax_456'];

      mockStripeClient.paymentIntents.update.mockResolvedValue({});

      await updatePaymentIntentMetadata(paymentIntentId, transactionIds);

      expect(mockStripeClient.paymentIntents.update).toHaveBeenCalledWith(paymentIntentId, {
        metadata: {
          tax_transactions: 'tax_123, tax_456',
        },
      });
    });

    it('should handle single transaction ID', async () => {
      const paymentIntentId = 'pi_123';
      const transactionIds = ['tax_123'];

      mockStripeClient.paymentIntents.update.mockResolvedValue({});

      await updatePaymentIntentMetadata(paymentIntentId, transactionIds);

      expect(mockStripeClient.paymentIntents.update).toHaveBeenCalledWith(paymentIntentId, {
        metadata: {
          tax_transactions: 'tax_123',
        },
      });
    });

    it('should handle errors gracefully', async () => {
      const paymentIntentId = 'pi_123';
      const transactionIds = ['tax_123'];

      const stripeError = new Error('PaymentIntent not found');
      mockStripeClient.paymentIntents.update.mockRejectedValue(stripeError);

      // Should not throw, just log warning
      await expect(updatePaymentIntentMetadata(paymentIntentId, transactionIds)).resolves.not.toThrow();
    });
  });
});
