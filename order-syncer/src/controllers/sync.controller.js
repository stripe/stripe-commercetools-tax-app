import { logger } from '../utils/logger.util.js';
import { doValidation } from '../validators/order-change.validators.js';
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
  getTransactionFromTaxAssociation, 
  updatePaymentIntentMetadata
} from '../extensions/stripe/clients/client.js';
import CustomError from '../errors/custom.error.js';
import { ORDER_TAX_FIELD_NAMES } from '../connectors/customTypes.js';

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
    logger.info(`Order with payment info: ${JSON.stringify(order)}`);
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
  const calcRefs = order?.custom?.fields?.[ORDER_TAX_FIELD_NAMES.CALCULATION_REFERENCES] || [];
  
  if (calcRefs.length === 0) {
    logger.warn(`Order ${orderId} has no calculation references. Skipping.`);
    return;
  }

  const paymentIntentId = order?.paymentInfo?.payments[0]?.obj?.interfaceId;

  // Single calculation: try Tax Association first
  if (calcRefs.length === 1 && paymentIntentId) {
    const existingTxnId = await getTransactionFromTaxAssociation(paymentIntentId);
    
    if (existingTxnId) {
      logger.info(`Found existing transaction ${existingTxnId} via Tax Association`);
      await updateOrderTaxTxn([{ id: existingTxnId }], orderId);
      return;
    }
  }

  // Create new transactions
  const transactions = await createTaxTransactions(orderId, calcRefs);
  await updateOrderTaxTxn(transactions, orderId);

  // Sync to PaymentIntent if available
  if (paymentIntentId && transactions.length > 0) {
    await updatePaymentIntentMetadata(paymentIntentId, transactions.map(t => t.id));
  }
}
