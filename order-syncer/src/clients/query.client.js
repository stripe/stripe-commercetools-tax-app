import { createApiRoot } from './create.client.js';
import CustomError from '../errors/custom.error.js';
import { HTTP_STATUS_SUCCESS_ACCEPTED } from '../constants/http.status.constants.js';
const queryArgs = {
  withTotal: false,
  expand: ['cart'],
};

/**
 * Get the cart by order ID.
 * @param {string} orderId - The ID of the order.
 * @returns {Promise<object>} The cart object.
 */
export async function getCartByOrderId(orderId) {
  return await createApiRoot()
    .orders()
    .withId({
      ID: orderId,
    })
    .get({ queryArgs })
    .execute()
    .then((response) => response.body?.cart?.obj)
    .catch((error) => {
      throw new CustomError(HTTP_STATUS_SUCCESS_ACCEPTED, error.message, error);
    });
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
