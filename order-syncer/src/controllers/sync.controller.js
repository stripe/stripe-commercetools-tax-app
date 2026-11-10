import { logger } from '../utils/logger.util.js';
import { doValidation } from '../validators/order-change.validators.js';
import { partitionReferencesByOrderBinding } from '../validators/calculation-binding.validators.js';
import { decodeToJson } from '../utils/decoder.util.js';
import { getOrderWithPaymentInfo } from '../clients/query.client.js';
import { updateOrderTaxTxn } from '../clients/update.client.js';
import {
  HTTP_STATUS_SUCCESS_NO_CONTENT,
  HTTP_STATUS_SERVER_ERROR,
  HTTP_STATUS_SUCCESS_ACCEPTED,
} from '../constants/http.status.constants.js';
import { 
  createTaxTransactions, 
  getTransactionFromTaxCalculation, 
  updatePaymentIntentMetadata
} from '../extensions/stripe/clients/client.js';
import CustomError from '../errors/custom.error.js';
import { ORDER_TAX_FIELD_NAMES } from '../connectors/customTypes.js';

// The most calculation references an order is checked for (SB3-238). A legitimate order carries a
// handful; tax-calculator cannot write more than ~49 calculations with line items in one pass
// (100 update actions per extension response) nor ~50 in its 2000 ms under Stripe's default limits.
// Above it, the list was written by hand: nothing is checked or filed, and the error log asks
// for manual filing — a 429 cannot then redeliver an unbounded list.
const MAX_CALCULATION_REFERENCES = 100;

/**
 * Sync handler for the Order Syncer
 * This function is called when a new order is created
 * 
 * @param {Object} request - The request object
 * @param {Object} response - The response object
 * @returns {Promise<void>} The response object
 */
export const syncHandler = async (request, response) => {
  try {
    // Receive the Pub/Sub message
    logger.info('Received Pub/Sub syncHandler message', { 
      messageId: request.body?.message?.messageId,
      publishTime: request.body?.message?.publishTime,
    });
    const encodedMessageBody = request.body?.message?.data;
    if (!encodedMessageBody) {
      logger.error('Missing message data from incoming event message.');
      throw new CustomError(
        HTTP_STATUS_SUCCESS_ACCEPTED,
        'Missing message data from incoming event message.'
      );
    }

    const messageBody = decodeToJson(encodedMessageBody);
    doValidation(messageBody);

    const orderId = messageBody?.resource?.id;
    const order = await getOrderWithPaymentInfo(orderId);
    logger.info(`Payment data for order ${orderId}:`, {
      calculationReferences: order?.custom?.fields?.[ORDER_TAX_FIELD_NAMES.CALCULATION_REFERENCES] || [],
      paymentIntentId: order?.paymentInfo?.payments[0]?.obj?.interfaceId
    });

    if (order) {
      await syncOrderToTaxProvider(orderId, order);
    }
  } catch (err) {
    logger.error(`Error in syncHandler: ${err.message}`);
    if (err.statusCode) return response.status(err.statusCode).send({
      message: err.message
    });
    return response.status(HTTP_STATUS_SERVER_ERROR).send({
      message: 'Internal server error'
    });
  }

  // Return the response for the client
  return response.status(HTTP_STATUS_SUCCESS_NO_CONTENT).send();
};

/**
 * Sync order to tax provider.
 * @param {string} orderId - The order ID.
 * @param {object} order - The order object.
 * @returns {Promise<void>} The updated order tax transactions.
 */
async function syncOrderToTaxProvider(orderId, order) {
  const storedRefs = order?.custom?.fields?.[ORDER_TAX_FIELD_NAMES.CALCULATION_REFERENCES] || [];
  const paymentIntentId = order?.paymentInfo?.payments[0]?.obj?.interfaceId;
  let transactions = [];

  if (storedRefs.length === 0) {
    // An emptied reference list on a paid order is an error, not a silent skip: the sale is unfiled
    // and a reference check cannot see it. Log at error level (so it is caught) but still
    // acknowledge the message — throwing would redeliver forever (SB3-238 AC-5; Issue 43).
    if (paymentIntentId) {
      logger.error(`Order ${orderId} has a payment but no calculation references — the sale is unfiled and needs manual filing.`);
    } else {
      logger.warn(`Order ${orderId} has no calculation references. Skipping.`);
    }
    return;
  }

  // Bind each stored reference to this order before filing: a reference the shopper appended or
  // forged does not belong to this order and must not be filed as its compliance transaction
  // (SB3-238 AC-5, the report's concealment step). order-syncer never recalculates (order-sync
  // Rule 1), so a reference that fails is skipped and flagged, never recomputed. A transient
  // provider failure while checking is not a verdict: partitionReferencesByOrderBinding re-throws
  // it before anything is filed, syncHandler answers with its error status, and Pub/Sub redelivers.
  // A repeated id is filed once, and a list over the bound is neither checked nor filed.
  const uniqueRefs = [...new Set(storedRefs)];
  if (uniqueRefs.length < storedRefs.length) {
    logger.warn(`Order ${orderId}: ${storedRefs.length - uniqueRefs.length} repeated calculation reference(s) dropped before filing.`);
  }
  if (uniqueRefs.length > MAX_CALCULATION_REFERENCES) {
    logger.error(`Order ${orderId}: ${uniqueRefs.length} calculation references exceed the bound of ${MAX_CALCULATION_REFERENCES} — none checked or filed, needs manual filing.`);
    return;
  }
  const { valid: calcRefs, invalid } = await partitionReferencesByOrderBinding(uniqueRefs, order);
  for (const bad of invalid) {
    logger.error(`Order ${orderId}: calculation reference ${bad.ref} does not belong to this order (${bad.reason}) — not filed.`);
  }
  if (calcRefs.length === 0) {
    // Every reference failed the binding — nothing can be filed, and we must not file a foreign or
    // stale calculation. Acknowledge (no redelivery loop); the error log is the signal to file by hand.
    logger.error(`Order ${orderId}: no calculation reference belongs to this order — nothing filed, needs manual filing.`);
    return;
  }

  // Single calculation: check if transaction already exists
  if (calcRefs.length === 1) {
    logger.info(`Case single calculation.`);

    const transaction = await getTransactionFromTaxCalculation(calcRefs[0], orderId, paymentIntentId);
    if (transaction?.id) {
      transactions.push(transaction);
      logger.info(`Found existing transaction with ID: ${transaction.id}`);
      await updateOrderTaxTxn(transactions, orderId);
    }
  } else {
    // Multiple calculations: create new transactions
    logger.info(`Case multiple calculations.`);

    transactions = await createTaxTransactions(orderId, calcRefs, paymentIntentId);
    await updateOrderTaxTxn(transactions, orderId);
  }

  // Sync to PaymentIntent if available
  if (paymentIntentId && transactions.length > 0) {
    await updatePaymentIntentMetadata(paymentIntentId, transactions.map(t => t.id));
  }
}
