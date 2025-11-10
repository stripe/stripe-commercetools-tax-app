import CustomError from './custom.error.js';
import { HTTP_STATUS_BAD_REQUEST } from '../constants/http.status.constants.js';

class ShipFromNotFoundError extends CustomError {
  constructor(message, cart) {
    super(
      HTTP_STATUS_BAD_REQUEST,
      message || 'Ship-from address could not be determined'
    );
    this.cart = cart;
    this.errorCode = 'ShipFromNotFound';
  }

  toCommercetoolsError() {
    return {
      code: 'InvalidInput',
      message: this.message,
      detailedErrorMessage: `${this.errorCode}: Unable to determine ship-from address for tax calculation. Please configure supply channels.`
    };
  }
}

export default ShipFromNotFoundError;