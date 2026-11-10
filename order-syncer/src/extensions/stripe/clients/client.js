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
 * Retrieve a Stripe Tax calculation with its line items, to verify a reference belongs to this
 * order before filing it (SB3-238 AC-5, ADR-012).
 * @param {string} calculationReference - The calculation reference.
 * @returns {Promise<object>} The Stripe Tax calculation (with line_items expanded).
 */
export async function retrieveCalculation(calculationReference) {
  return getStripeClient().tax.calculations.retrieve(calculationReference, {
    expand: ['line_items']
  });
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
    // An "already exists" error names a transaction that was filed before. Only adopt it if it
    // belongs to THIS order (metadata.ct_order_id) — otherwise this order would link to another
    // order's transaction, which is exactly what a forged reference would cause (SB3-238).
    const existingId = error.message.match(/tax transaction (tax_\w+)/)?.[1];
    if (existingId) {
      try {
        const existing = await getStripeClient().tax.transactions.retrieve(existingId);
        if (existing?.metadata?.ct_order_id === orderId) {
          transaction.id = existingId;
        } else {
          logger.error(`Tax transaction ${existingId} for calculation ${calculationReference} belongs to order ${existing?.metadata?.ct_order_id}, not ${orderId}; not adopting it.`);
        }
      } catch (retrieveError) {
        logger.warn(`Could not verify existing transaction ${existingId}: ${retrieveError.message}`);
      }
    }

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