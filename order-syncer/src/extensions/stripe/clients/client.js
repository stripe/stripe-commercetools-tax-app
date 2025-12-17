import Stripe from 'stripe';
import { loadConfig } from '../configurations/config.js';
import { logger } from '../../../utils/logger.util.js';

let stripeClient;

/**
 * Get the Stripe client instance.
 * @returns {Stripe} The Stripe client.
 */
function getStripeClient() {
  if (!stripeClient) {
    stripeClient = new Stripe(loadConfig().taxProviderApiToken);
  }
  return stripeClient;
}

/**
 * Get tax transaction ID from Tax Calculation.
 * @param {string} calculationReference - The calculation reference.
 * @param {string} orderId - The order ID.
 * @param {string} paymentIntentId - The payment intent ID.
 * @returns {Promise<object>} Transaction object.
 */
export async function getTransactionFromTaxCalculation(calculationReference, orderId, paymentIntentId) {
  let transaction = {};

  try {
    transaction = await getStripeClient().tax.transactions.createFromCalculation({
      calculation: calculationReference,
      reference: calculationReference,
      metadata: {
        ct_order_id: orderId,
        paymentIntentId: paymentIntentId
      }
    });
  } catch (error) {
    transaction.id = error.message.match(/tax transaction (tax_\w+)/)?.[1];
    
    if (error.code !== 'resource_missing' && error.statusCode !== 404) {
      logger.warn(`Error retrieving Tax Transaction: ${error.message}`);
    }
  }

  return transaction;
}

/**
 * Create a new tax transaction.
 * @param {string} orderId - The ID of the order.
 * @param {Array<string>} calculationReferences - The calculation references.
 * @param {string} paymentIntentId - The payment intent ID.
 * @returns {Promise<Array<object>>} The tax transactions.
 */
export async function createTaxTransactions(orderId, calculationReferences, paymentIntentId) {
  const client = getStripeClient();

  const taxTransactions = [];

  for (const calculationReference of calculationReferences) {
    const txnCreateFromCalculationParams = {
      calculation: calculationReference,
      reference: calculationReference,
      metadata: {
        ct_order_id: orderId,
        paymentIntentId: paymentIntentId
      }
    };

    const response = await client.tax.transactions.createFromCalculation(txnCreateFromCalculationParams);
    taxTransactions.push(response);
  }

  return taxTransactions;
}

/**
 * Update PaymentIntent metadata with transaction IDs.
 * @param {string} paymentIntentId - The PaymentIntent ID.
 * @param {Array<string>} transactionIds - Transaction IDs.
 * @returns {Promise<void>} The updated PaymentIntent metadata.
 */
export async function updatePaymentIntentMetadata(paymentIntentId, transactionIds) {
  try {
    await getStripeClient().paymentIntents.update(paymentIntentId, {
      metadata: {
        tax_transactions: transactionIds.join(', ')
      },
    });
    logger.info(`Updated PaymentIntent ${paymentIntentId} with metadata: ${transactionIds.join(', ')}`);
  } catch (error) {
    logger.warn(`Could not update PaymentIntent metadata: ${error.message}`);
  }
}