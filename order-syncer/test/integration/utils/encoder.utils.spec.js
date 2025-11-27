import { expect, describe, it } from '@jest/globals';
import { encodeJsonObject } from './encoder.utils.js';

describe('encoder.utils.spec', () => {
  describe('encodeJsonObject', () => {
    it('should encode a JSON object to base64', () => {
      const messageBody = {
        notificationType: 'Message',
        resource: { typeId: 'order', id: 'order-123' },
        type: 'OrderCreated',
      };

      const result = encodeJsonObject(messageBody);

      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
      // Decode to verify it's correct base64
      const decoded = JSON.parse(Buffer.from(result, 'base64').toString());
      expect(decoded).toEqual(messageBody);
    });

    it('should encode different JSON objects correctly', () => {
      const messageBody1 = { test: 'value1' };
      const messageBody2 = { test: 'value2', nested: { key: 'value' } };

      const result1 = encodeJsonObject(messageBody1);
      const result2 = encodeJsonObject(messageBody2);

      expect(result1).not.toBe(result2);
      expect(JSON.parse(Buffer.from(result1, 'base64').toString())).toEqual(messageBody1);
      expect(JSON.parse(Buffer.from(result2, 'base64').toString())).toEqual(messageBody2);
    });

    it('should handle empty objects', () => {
      const messageBody = {};

      const result = encodeJsonObject(messageBody);

      expect(result).toBeDefined();
      const decoded = JSON.parse(Buffer.from(result, 'base64').toString());
      expect(decoded).toEqual({});
    });

    it('should handle objects with arrays', () => {
      const messageBody = {
        items: ['item1', 'item2', 'item3'],
        count: 3,
      };

      const result = encodeJsonObject(messageBody);

      const decoded = JSON.parse(Buffer.from(result, 'base64').toString());
      expect(decoded).toEqual(messageBody);
    });

    it('should return trimmed base64 string', () => {
      const messageBody = { test: 'value' };

      const result = encodeJsonObject(messageBody);

      // Should not have leading or trailing whitespace
      expect(result).toBe(result.trim());
    });
  });
});

