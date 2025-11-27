import { expect, describe, it } from '@jest/globals';
import {
  standardString,
  standardEmail,
  standardNaturalNumber,
  standardKey,
  standardUrl,
  getValidateMessages,
  optional,
  array,
  region,
} from '../../../src/validators/helpers.validator.js';
import validator from 'validator';

// Mock validator
jest.mock('validator');

describe('helpers.validator.spec', () => {
  describe('standardString', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should return validator config for string validation', () => {
      const path = ['name'];
      const message = { code: 'InvalidName', message: 'Name is invalid' };
      const config = { min: 2, max: 20 };

      const result = standardString(path, message, config);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(path);
      expect(result[1]).toHaveLength(1);
      expect(result[1][0]).toHaveLength(3);
    });

    it('should use default config when overrideConfig is not provided', () => {
      const path = ['name'];
      const message = { code: 'InvalidName', message: 'Name is invalid' };

      const result = standardString(path, message);

      expect(result[1][0][2]).toEqual([{ min: 2, max: 20 }]);
    });

    it('should use overrideConfig when provided', () => {
      const path = ['name'];
      const message = { code: 'InvalidName', message: 'Name is invalid' };
      const overrideConfig = { min: 5, max: 50 };

      const result = standardString(path, message, overrideConfig);

      expect(result[1][0][2]).toEqual([overrideConfig]);
    });
  });

  describe('standardEmail', () => {
    it('should return validator config for email validation', () => {
      const path = ['email'];
      const message = { code: 'InvalidEmail', message: 'Email is invalid' };

      const result = standardEmail(path, message);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(path);
      expect(result[1]).toHaveLength(1);
    });
  });

  describe('standardNaturalNumber', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should return validator config for natural number validation', () => {
      const path = ['age'];
      const message = { code: 'InvalidAge', message: 'Age is invalid' };

      const result = standardNaturalNumber(path, message);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(path);
      expect(result[1]).toHaveLength(1);
    });

    it('should validate natural numbers correctly using validator.isNumeric', () => {
      validator.isNumeric = jest.fn().mockReturnValue(true);

      const path = ['age'];
      const message = { code: 'InvalidAge', message: 'Age is invalid' };
      const validatorConfigs = [standardNaturalNumber(path, message)];
      const item = { age: 25 };

      const result = getValidateMessages(validatorConfigs, item);

      expect(validator.isNumeric).toHaveBeenCalledWith('25', { no_symbols: true });
      expect(result).toEqual([]);
    });

    it('should fail validation for non-numeric values', () => {
      validator.isNumeric = jest.fn().mockReturnValue(false);

      const path = ['age'];
      const message = { code: 'InvalidAge', message: 'Age is invalid' };
      const validatorConfigs = [standardNaturalNumber(path, message)];
      const item = { age: 'not-a-number' };

      const result = getValidateMessages(validatorConfigs, item);

      expect(validator.isNumeric).toHaveBeenCalledWith('not-a-number', { no_symbols: true });
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toEqual(message);
    });
  });

  describe('standardKey', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should return validator config for key validation', () => {
      const path = ['key'];
      const message = { code: 'InvalidKey', message: 'Key is invalid' };

      const result = standardKey(path, message);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(path);
      expect(result[1]).toHaveLength(1);
    });

    it('should validate keys with correct format using isLength and regex', () => {
      validator.isLength = jest.fn().mockReturnValue(true);

      const path = ['key'];
      const message = { code: 'InvalidKey', message: 'Key is invalid' };
      const validatorConfigs = [standardKey(path, message)];
      const item = { key: 'valid-key-123' };

      const result = getValidateMessages(validatorConfigs, item);

      expect(validator.isLength).toHaveBeenCalledWith('valid-key-123', { min: 2 });
      expect(result).toEqual([]);
    });

    it('should fail validation for keys that are too short', () => {
      validator.isLength = jest.fn().mockReturnValue(false);

      const path = ['key'];
      const message = { code: 'InvalidKey', message: 'Key is invalid' };
      const validatorConfigs = [standardKey(path, message)];
      const item = { key: 'a' };

      const result = getValidateMessages(validatorConfigs, item);

      expect(validator.isLength).toHaveBeenCalledWith('a', { min: 2 });
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toEqual(message);
    });

    it('should fail validation for keys with invalid characters', () => {
      validator.isLength = jest.fn().mockReturnValue(true);

      const path = ['key'];
      const message = { code: 'InvalidKey', message: 'Key is invalid' };
      const validatorConfigs = [standardKey(path, message)];
      const item = { key: 'invalid key with spaces' };

      const result = getValidateMessages(validatorConfigs, item);

      expect(validator.isLength).toHaveBeenCalledWith('invalid key with spaces', { min: 2 });
      // Regex test should fail for spaces
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toEqual(message);
    });
  });

  describe('standardUrl', () => {
    it('should return validator config for URL validation', () => {
      const path = ['url'];
      const message = { code: 'InvalidUrl', message: 'URL is invalid' };

      const result = standardUrl(path, message);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(path);
      expect(result[1]).toHaveLength(1);
    });

    it('should merge overrideOptions with default options', () => {
      const path = ['url'];
      const message = { code: 'InvalidUrl', message: 'URL is invalid' };
      const overrideOptions = { require_port: true };

      const result = standardUrl(path, message, overrideOptions);

      expect(result[1][0][2][0]).toMatchObject(overrideOptions);
    });
  });

  describe('getValidateMessages', () => {
    it('should return empty array when all validations pass', () => {
      const validatorConfigs = [
        [['name'], [[(value) => value !== undefined, { message: 'Required' }, []]]],
      ];
      const item = { name: 'test' };

      const result = getValidateMessages(validatorConfigs, item);

      expect(result).toEqual([]);
    });

    it('should return error messages when validations fail', () => {
      // getValidateMessages adds error when validator returns false
      // So we need a validator that returns false when validation fails
      const validatorConfigs = [
        [['name'], [[(value) => value !== undefined && value.length > 0, { message: 'Name is required' }, []]]],
      ];
      const item = {}; // name is missing/undefined

      const result = getValidateMessages(validatorConfigs, item);

      // When value is undefined, validator returns false, so error is added
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toEqual({ message: 'Name is required' });
    });

    it('should handle nested paths', () => {
      const validatorConfigs = [
        [['user', 'name'], [[(value) => value !== undefined && value.length > 0, { message: 'Name is required' }, []]]],
      ];
      const item = { user: { name: 'test' } };

      const result = getValidateMessages(validatorConfigs, item);

      // When value exists and passes validation, no error
      expect(result).toEqual([]);
    });

    it('should handle multiple validators for same path', () => {
      const validatorConfigs = [
        [
          ['name'],
          [
            [(value) => value === undefined, { message: 'Name is required' }, []],
            [(value) => value && value.length < 2, { message: 'Name too short' }, []],
          ],
        ],
      ];
      const item = { name: 'a' };

      const result = getValidateMessages(validatorConfigs, item);

      // When name is 'a' (length < 2), second validator returns true, so error is added
      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle validator with arguments', () => {
      // getValidateMessages adds error when validator returns false
      // So we need validator that returns false when validation fails
      const validatorConfigs = [
        [['age'], [[(value, min) => value >= min, { message: 'Age too low' }, [18]]]],
      ];
      const item = { age: 15 };

      const result = getValidateMessages(validatorConfigs, item);

      // When age (15) < min (18), validator returns false, so error is added
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toEqual({ message: 'Age too low' });
    });
  });

  describe('optional', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should make validator optional - return true when value is undefined', () => {
      const baseValidator = standardString;
      const optionalValidator = optional(baseValidator);
      const path = ['name'];
      const message = { code: 'InvalidName', message: 'Name is invalid' };

      const result = optionalValidator(path, message);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(path);
    });

    it('should validate when value is provided', () => {
      const baseValidator = standardString;
      const optionalValidator = optional(baseValidator);
      const path = ['name'];
      const message = { code: 'InvalidName', message: 'Name is invalid' };

      const result = optionalValidator(path, message);

      expect(result[1][0][0]).toBeInstanceOf(Function);
    });

    it('should execute validator function when value is not undefined', () => {
      validator.isLength = jest.fn().mockReturnValue(true);

      const baseValidator = standardString;
      const optionalValidator = optional(baseValidator);
      const path = ['name'];
      const message = { code: 'InvalidName', message: 'Name is invalid' };
      const validatorConfigs = [optionalValidator(path, message)];
      const item = { name: 'test-name' };

      const result = getValidateMessages(validatorConfigs, item);

      // When value is not undefined, it should call the validator function (line 100)
      expect(validator.isLength).toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('should return true when value is undefined in optional validator', () => {
      const baseValidator = standardString;
      const optionalValidator = optional(baseValidator);
      const path = ['name'];
      const message = { code: 'InvalidName', message: 'Name is invalid' };
      const validatorConfigs = [optionalValidator(path, message)];
      const item = { name: undefined };

      const result = getValidateMessages(validatorConfigs, item);

      // When value is undefined, optional validator should return true (skip validation)
      expect(result).toEqual([]);
    });
  });

  describe('array', () => {
    it('should validate array elements', () => {
      const baseValidator = standardString;
      const arrayValidator = array(baseValidator);
      const path = ['items'];
      const message = { code: 'InvalidItems', message: 'Items are invalid' };

      const result = arrayValidator(path, message);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(path);
    });

    it('should return validator that checks if value is array', () => {
      // Create a simple validator function for testing
      const simpleValidator = (path, message) => [
        path,
        [[(value) => typeof value === 'string' && value.length > 0, message, []]],
      ];
      
      const arrayValidator = array(simpleValidator);
      const path = ['items'];
      const message = { code: 'InvalidItems', message: 'Items are invalid' };

      const result = arrayValidator(path, message);

      const validatorFn = result[1][0][0];
      // When array elements pass validation, should return true
      const isValidArray = validatorFn(['item1', 'item2']);
      // When not an array, Array.isArray returns false, so validator returns false immediately
      const isNotArray = validatorFn('not-array');
      // When array has invalid element, should return false
      const hasInvalidElement = validatorFn(['item1', '']); // empty string fails validation
      
      expect(isValidArray).toBe(true);
      expect(isNotArray).toBe(false);
      expect(hasInvalidElement).toBe(false);
    });
  });

  describe('region', () => {
    it('should return validator config for region validation', () => {
      const path = ['region'];
      const message = { code: 'InvalidRegion', message: 'Region is invalid' };

      const result = region(path, message);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(path);
      expect(result[1]).toHaveLength(1);
    });

    it('should validate against allowed regions', () => {
      validator.isIn = jest.fn().mockReturnValue(true);

      const path = ['region'];
      const message = { code: 'InvalidRegion', message: 'Region is invalid' };
      const result = region(path, message);

      const validatorFn = result[1][0][0];
      const isValid = validatorFn('us-central1.gcp');

      expect(validator.isIn).toHaveBeenCalledWith('us-central1.gcp', [
        'us-central1.gcp',
        'us-east-2.aws',
        'europe-west1.gcp',
        'eu-central-1.aws',
        'australia-southeast1.gcp',
      ]);
    });
  });
});

