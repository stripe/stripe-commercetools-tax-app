import { createApiRoot } from './create.client.js';
import CustomError from '../errors/custom.error.js';
import { HTTP_STATUS_SUCCESS_ACCEPTED } from '../constants/http.status.constants.js';

/**
 * Get order with payment info expanded.
 * @param {string} orderId - The ID of the order.
 * @returns {Promise<object>} The order object with payments expanded.
 */
export async function getOrderWithPaymentInfo(orderId) {
  return await createApiRoot()
    .orders()
    .withId({
      ID: orderId,
    })
    .get({ queryArgs: { withTotal: false, expand: ['paymentInfo.payments[*]'] } })
    .execute()
    .then((response) => response.body)
    .catch((error) => {
      throw new CustomError(HTTP_STATUS_SUCCESS_ACCEPTED, error.message, error);
    })
}

/**
 * Get the order by order ID.
 * @param {string} orderId - The ID of the order.
 * @returns {Promise<object>} The order object.
 */
export async function getOrder(orderId) {
  return await createApiRoot()
    .orders()
    .withId({
      ID: orderId,
    })
    .get()
    .execute()
    .then((response) => response.body)
    .catch((error) => {
      throw new CustomError(HTTP_STATUS_SUCCESS_ACCEPTED, error.message, error);
    });
}
