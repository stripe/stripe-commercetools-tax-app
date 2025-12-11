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
 * Get tax transaction ID from Tax Association.
 * @param {string} paymentIntentId - The PaymentIntent ID.
 * @returns {Promise<string|null>} Transaction ID or null.
 */
export async function getTransactionFromTaxAssociation(paymentIntentId) {
  try {
    const association = await getStripeClient().tax.associations.find({
      payment_intent: paymentIntentId,
    });
    
    const committed = association.tax_transaction_attempts?.find(a => a.status === 'committed');
    return committed?.committed?.transaction || null;
  } catch (error) {
    if (error.code !== 'resource_missing' && error.statusCode !== 404) {
      logger.warn(`Error retrieving Tax Association: ${error.message}`);
    }
    return null;
  }
}

/**
 * Create a new tax transaction.
 * @param {string} orderId - The ID of the order.
 * @param {Array<string>} calculationReferences - The calculation references.
 * @returns {Promise<Array<object>>} The tax transactions.
 */
export async function createTaxTransactions(orderId, calculationReferences) {
  const client = getStripeClient();

  const taxTransactions = [];

  for (const calculationReference of calculationReferences) {
    const txnCreateFromCalculationParams = {
      calculation: calculationReference,
      reference: orderId,
      metadata: {
        ct_order_id: orderId
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
    logger.info(`Updated PaymentIntent ${paymentIntentId} metadata`);
  } catch (error) {
    logger.warn(`Could not update PaymentIntent metadata: ${error.message}`);
  }
}