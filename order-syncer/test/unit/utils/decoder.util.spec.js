import { expect, describe, it } from '@jest/globals';
import { decodeToJson } from '../../../src/utils/decoder.util.js';

describe('decoder.util.spec', () => {
  // decodeToString is a private function, tested indirectly through decodeToJson

  describe('decodeToJson', () => {
    it('should decode base64 string to JSON object', () => {
      const jsonObject = { test: 'value', number: 123 };
      const base64String = Buffer.from(JSON.stringify(jsonObject)).toString('base64');
      const decoded = decodeToJson(base64String);
      expect(decoded).toEqual(jsonObject);
    });

    it('should handle complex JSON objects', () => {
      const complexObject = {
        notificationType: 'Message',
        resource: { typeId: 'order', id: 'order-123' },
        type: 'OrderCreated',
        version: 1,
      };
      const base64String = Buffer.from(JSON.stringify(complexObject)).toString('base64');
      const decoded = decodeToJson(base64String);
      expect(decoded).toEqual(complexObject);
    });

    it('should handle arrays in JSON', () => {
      const arrayObject = { items: [1, 2, 3], names: ['a', 'b', 'c'] };
      const base64String = Buffer.from(JSON.stringify(arrayObject)).toString('base64');
      const decoded = decodeToJson(base64String);
      expect(decoded).toEqual(arrayObject);
    });

    it('should throw error for invalid JSON', () => {
      const invalidJson = 'not valid json';
      const base64String = Buffer.from(invalidJson).toString('base64');
      expect(() => decodeToJson(base64String)).toThrow();
    });

    it('should handle empty JSON object', () => {
      const emptyObject = {};
      const base64String = Buffer.from(JSON.stringify(emptyObject)).toString('base64');
      const decoded = decodeToJson(base64String);
      expect(decoded).toEqual(emptyObject);
    });
  });
});

