import { expect, describe, it } from '@jest/globals';
import { doValidation } from '../../../src/validators/order-change.validators.js';
import CustomError from '../../../src/errors/custom.error.js';
import {
  HTTP_STATUS_SUCCESS_ACCEPTED,
  HTTP_STATUS_SUCCESS_NO_CONTENT,
} from '../../../src/constants/http.status.constants.js';
import {
  MESSAGE_TYPE,
  NOTIFICATION_TYPE_RESOURCE_CREATED,
} from '../../../src/constants/connectors.constants.js';

describe('order-change.validators.spec', () => {
  describe('doValidation', () => {
    it('should throw CustomError when messageBody is missing', () => {
      expect(() => doValidation(null)).toThrow(CustomError);
      expect(() => doValidation(null)).toThrow('The incoming message body is missing');
    });

    it('should throw CustomError when messageBody is undefined', () => {
      expect(() => doValidation(undefined)).toThrow(CustomError);
      expect(() => doValidation(undefined)).toThrow('The incoming message body is missing');
    });

    it('should throw CustomError with NO_CONTENT status when notificationType is ResourceCreated', () => {
      const messageBody = {
        notificationType: NOTIFICATION_TYPE_RESOURCE_CREATED,
        type: 'OrderCreated',
        resource: { typeId: 'order', id: 'order-123' },
      };

      expect(() => doValidation(messageBody)).toThrow(CustomError);
      try {
        doValidation(messageBody);
      } catch (error) {
        expect(error.statusCode).toBe(HTTP_STATUS_SUCCESS_NO_CONTENT);
        expect(error.message).toContain('subscription resource creation');
      }
    });

    it('should throw CustomError when message type is not in MESSAGE_TYPE array', () => {
      const messageBody = {
        notificationType: 'Message',
        type: 'InvalidMessageType',
        resource: { typeId: 'order', id: 'order-123' },
      };

      expect(() => doValidation(messageBody)).toThrow(CustomError);
      try {
        doValidation(messageBody);
      } catch (error) {
        expect(error.statusCode).toBe(HTTP_STATUS_SUCCESS_ACCEPTED);
        expect(error.message).toContain('Message type InvalidMessageType is incorrect');
      }
    });

    it('should throw CustomError when resource typeId is not "order"', () => {
      const messageBody = {
        notificationType: 'Message',
        type: MESSAGE_TYPE[0],
        resource: { typeId: 'product', id: 'product-123' },
      };

      expect(() => doValidation(messageBody)).toThrow(CustomError);
      try {
        doValidation(messageBody);
      } catch (error) {
        expect(error.statusCode).toBe(HTTP_STATUS_SUCCESS_ACCEPTED);
        expect(error.message).toContain('No order ID is found in message');
      }
    });

    it('should throw CustomError when resource id is missing', () => {
      const messageBody = {
        notificationType: 'Message',
        type: MESSAGE_TYPE[0],
        resource: { typeId: 'order' },
      };

      expect(() => doValidation(messageBody)).toThrow(CustomError);
      try {
        doValidation(messageBody);
      } catch (error) {
        expect(error.statusCode).toBe(HTTP_STATUS_SUCCESS_ACCEPTED);
        expect(error.message).toContain('No order ID is found in message');
      }
    });

    it('should throw CustomError when resource is missing', () => {
      const messageBody = {
        notificationType: 'Message',
        type: MESSAGE_TYPE[0],
      };

      expect(() => doValidation(messageBody)).toThrow(CustomError);
      try {
        doValidation(messageBody);
      } catch (error) {
        expect(error.statusCode).toBe(HTTP_STATUS_SUCCESS_ACCEPTED);
        expect(error.message).toContain('No order ID is found in message');
      }
    });

    it('should not throw error for valid message body', () => {
      const messageBody = {
        notificationType: 'Message',
        type: MESSAGE_TYPE[0],
        resource: { typeId: 'order', id: 'order-123' },
        version: 1,
      };

      expect(() => doValidation(messageBody)).not.toThrow();
    });

    it('should validate successfully with all valid MESSAGE_TYPE values', () => {
      MESSAGE_TYPE.forEach((messageType) => {
        const messageBody = {
          notificationType: 'Message',
          type: messageType,
          resource: { typeId: 'order', id: 'order-123' },
        };

        expect(() => doValidation(messageBody)).not.toThrow();
      });
    });
  });
});

