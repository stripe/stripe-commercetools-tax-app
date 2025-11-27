import { createApiRoot } from './create.client.js';
import CustomError from '../errors/custom.error.js';
import { HTTP_STATUS_SUCCESS_ACCEPTED } from '../constants/http.status.constants.js';
import { getOrder } from './query.client.js';
import { ORDER_TAX_FIELD_NAMES } from '../connectors/customTypes.js';

/**
 * Update the order with tax transaction references.
 * @param {Array<object>} taxTransactions - The tax transactions.
 * @param {string} orderId - The ID of the order.
 * @returns {Promise<object>} The order object.
 */
export async function updateOrderTaxTxn(taxTransactions, orderId) {
  let actions = [];

  actions.push({
    action: 'setCustomField',
    name: ORDER_TAX_FIELD_NAMES.TRANSACTION_REFERENCES,
    value: taxTransactions.map(txn => txn.id)
  });

  const order = await getOrder(orderId);
  return await createApiRoot()
    .orders()
    .withId({
      ID: order.id,
    })
    .post({
      body: {
        actions: actions,
        version: order.version,
      },
    })
    .execute()
    .catch((error) => {
      throw new CustomError(HTTP_STATUS_SUCCESS_ACCEPTED, error.message, error);
    });
}
