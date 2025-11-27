import { expect, describe, it } from '@jest/globals';
import ShipFromNotFoundError from '../../../src/errors/shipFromNotFoundError.js';
import { HTTP_STATUS_BAD_REQUEST } from '../../../src/constants/http.status.constants.js';

describe('ShipFromNotFoundError', () => {
  it('should create error with default message', () => {
    const cart = { id: 'cart-123' };
    const error = new ShipFromNotFoundError(undefined, cart);

    expect(error).toBeInstanceOf(Error);
    expect(error.statusCode).toBe(HTTP_STATUS_BAD_REQUEST);
    expect(error.message).toBe('Ship-from address could not be determined');
    expect(error.cart).toBe(cart);
    expect(error.errorCode).toBe('ShipFromNotFound');
  });

  it('should create error with custom message', () => {
    const cart = { id: 'cart-456' };
    const customMessage = 'Custom ship-from error';
    const error = new ShipFromNotFoundError(customMessage, cart);

    expect(error.message).toBe(customMessage);
    expect(error.cart).toBe(cart);
  });

  it('should convert to commercetools error format', () => {
    const cart = { id: 'cart-789' };
    const error = new ShipFromNotFoundError('Test message', cart);

    const commercetoolsError = error.toCommercetoolsError();

    expect(commercetoolsError).toEqual({
      code: 'InvalidInput',
      message: 'Test message',
      detailedErrorMessage: 'ShipFromNotFound: Unable to determine ship-from address for tax calculation. Please configure supply channels.'
    });
  });

  it('should be throwable and catchable', () => {
    const cart = { id: 'cart-error' };
    
    expect(() => {
      throw new ShipFromNotFoundError('Error message', cart);
    }).toThrow('Error message');

    try {
      throw new ShipFromNotFoundError('Test', cart);
    } catch (error) {
      expect(error).toBeInstanceOf(ShipFromNotFoundError);
      expect(error.statusCode).toBe(HTTP_STATUS_BAD_REQUEST);
      expect(error.cart).toBe(cart);
    }
  });
});

