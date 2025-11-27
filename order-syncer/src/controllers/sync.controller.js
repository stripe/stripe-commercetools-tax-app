import { logger } from '../utils/logger.util.js';
import { doValidation } from '../validators/order-change.validators.js';
import { decodeToJson } from '../utils/decoder.util.js';
import { getCartByOrderId } from '../clients/query.client.js';
import { updateOrderTaxTxn } from '../clients/update.client.js';
import {
  HTTP_STATUS_SUCCESS_NO_CONTENT,
  HTTP_STATUS_SERVER_ERROR,
  HTTP_STATUS_SUCCESS_ACCEPTED,
} from '../constants/http.status.constants.js';
import createTaxTransaction from '../extensions/stripe/clients/client.js';
import CustomError from '../errors/custom.error.js';

/**
 * Sync handler for the Order Syncer
 * This function is called when a new order is created
 * 
 * @param {Object} request - The request object
 * @param {Object} response - The response object
 * @returns {Promise<Object>} The response object
 */
export const syncHandler = async (request, response) => {
  try {
    // Receive the Pub/Sub message
    logger.info(`Received Pub/Sub syncHandler message: ${JSON.stringify(request.body,null,2)}`);
    const encodedMessageBody = request.body?.message?.data;
    if (!encodedMessageBody) {
      throw new CustomError(
        HTTP_STATUS_SUCCESS_ACCEPTED,
        'Missing message data from incoming event message.'
      );
    }

    const messageBody = decodeToJson(encodedMessageBody);
    doValidation(messageBody);

    const orderId = messageBody?.resource?.id;
    const cart = await getCartByOrderId(orderId);
    if (cart) {
      await syncOrderToTaxProvider(orderId, cart);
    }
  } catch (err) {
    logger.error(err);
    if (err.statusCode) return response.status(err.statusCode).send(err);
    return response.status(HTTP_STATUS_SERVER_ERROR).send(err);
  }

  // Return the response for the client
  return response.status(HTTP_STATUS_SUCCESS_NO_CONTENT).send();
};

/**
 * Sync to the tax provider
 * This function is called to sync the order to the tax provider
 * 
 * @param {string} orderId - The order ID
 * @param {Object} cart - The cart object
 * @returns {Promise<void>} The response object
 */
async function syncOrderToTaxProvider(orderId, cart) {
  const taxTransactions = await createTaxTransaction(orderId, cart).catch(
    (error) => {
      throw new CustomError(
        HTTP_STATUS_SUCCESS_ACCEPTED,
        `Error from extension : ${error.message}`,
        error
      );
    }
  );

  logger.info(
    `Tax transactions from Stripe of order ${orderId} : ${taxTransactions.map(txn => txn.id).join(', ')}`
  );

  if (taxTransactions.length > 0) {
    await updateOrderTaxTxn(taxTransactions, orderId);
  }
}
