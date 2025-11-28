import { expect, describe, it, jest, beforeEach, afterEach } from '@jest/globals';
import configUtil from '../../../src/utils/config.util.js';
import CustomError from '../../../src/errors/custom.error.js';

// Mock dependencies
jest.mock('../../../src/validators/env-var.validators.js', () => ({
  default: []
}));

jest.mock('../../../src/validators/helpers.validators.js', () => ({
  getValidateMessages: jest.fn()
}));

jest.mock('../../../src/errors/custom.error.js', () => {
  const MockCustomError = jest.fn().mockImplementation((statusCode, message, errors) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.message = message;
    if (errors) {
      error.errors = errors;
    }
    Object.setPrototypeOf(error, MockCustomError.prototype);
    return error;
  });
  return MockCustomError;
});

import envValidators from '../../../src/validators/env-var.validators.js';
import { getValidateMessages } from '../../../src/validators/helpers.validators.js';

describe('ConfigUtil', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('readConfiguration', () => {
    it('should return configuration when all env vars are valid', () => {
      process.env.CTP_CLIENT_ID = '123456789012345678901234';
      process.env.CTP_CLIENT_SECRET = '12345678901234567890123456789012';
      process.env.CTP_PROJECT_KEY = 'test-project';
      process.env.CTP_SCOPE = 'test-scope';
      process.env.CTP_REGION = 'us-central1.gcp';
      process.env.STRIPE_API_TOKEN = 'sk_test_token';
      process.env.TAX_CODE_CATEGORY_MAPPING_JSON = '{}';
      process.env.TAX_BEHAVIOR_DEFAULT = 'exclusive';
      process.env.TAX_BEHAVIOR_COUNTRY_MAPPING = '{}';

      getValidateMessages.mockReturnValue([]);

      const config = configUtil.readConfiguration();

      expect(config).toEqual({
        clientId: '123456789012345678901234',
        clientSecret: '12345678901234567890123456789012',
        projectKey: 'test-project',
        scope: 'test-scope',
        region: 'us-central1.gcp',
        stripeApiToken: 'sk_test_token',
        taxCodeMapping: '{}',
        taxBehaviorDefault: 'exclusive',
        countryTaxBehaviorMapping: '{}'
      });

      expect(getValidateMessages).toHaveBeenCalledWith(
        envValidators,
        expect.objectContaining({
          clientId: '123456789012345678901234',
          clientSecret: '12345678901234567890123456789012',
          projectKey: 'test-project',
          scope: 'test-scope',
          region: 'us-central1.gcp',
          stripeApiToken: 'sk_test_token',
          taxCodeMapping: '{}',
          taxBehaviorDefault: 'exclusive',
          countryTaxBehaviorMapping: '{}'
        })
      );
    });

    it('should throw CustomError when validation errors exist', () => {
      process.env.CTP_CLIENT_ID = 'invalid';
      process.env.CTP_CLIENT_SECRET = '12345678901234567890123456789012';
      process.env.CTP_PROJECT_KEY = 'test-project';
      process.env.CTP_REGION = 'us-central1.gcp';
      process.env.STRIPE_API_TOKEN = 'sk_test_token';

      const validationErrors = [
        {
          code: 'InValidClientId',
          message: 'Client id should be 24 characters.',
          referencedBy: 'environmentVariables'
        }
      ];

      getValidateMessages.mockReturnValue(validationErrors);

      expect(() => {
        configUtil.readConfiguration();
      }).toThrow(CustomError);

      expect(CustomError).toHaveBeenCalledWith(
        'InvalidEnvironmentVariablesError',
        'Invalid Environment Variables please check your .env file',
        validationErrors
      );
    });

    it('should handle missing optional env vars', () => {
      process.env.CTP_CLIENT_ID = '123456789012345678901234';
      process.env.CTP_CLIENT_SECRET = '12345678901234567890123456789012';
      process.env.CTP_PROJECT_KEY = 'test-project';
      process.env.CTP_REGION = 'us-central1.gcp';
      process.env.STRIPE_API_TOKEN = 'sk_test_token';
      
      // Optional vars not set
      delete process.env.CTP_SCOPE;
      delete process.env.TAX_CODE_CATEGORY_MAPPING_JSON;
      delete process.env.TAX_BEHAVIOR_DEFAULT;
      delete process.env.TAX_BEHAVIOR_COUNTRY_MAPPING;

      getValidateMessages.mockReturnValue([]);

      const config = configUtil.readConfiguration();

      expect(config.scope).toBeUndefined();
      expect(config.taxCodeMapping).toBeUndefined();
      expect(config.taxBehaviorDefault).toBeUndefined();
      expect(config.countryTaxBehaviorMapping).toBeUndefined();
    });

    it('should include all env vars in validation call', () => {
      process.env.CTP_CLIENT_ID = '123456789012345678901234';
      process.env.CTP_CLIENT_SECRET = '12345678901234567890123456789012';
      process.env.CTP_PROJECT_KEY = 'test-project';
      process.env.CTP_SCOPE = 'test-scope';
      process.env.CTP_REGION = 'us-central1.gcp';
      process.env.STRIPE_API_TOKEN = 'sk_test_token';
      process.env.TAX_CODE_CATEGORY_MAPPING_JSON = '{"categories": []}';
      process.env.TAX_BEHAVIOR_DEFAULT = 'inclusive';
      process.env.TAX_BEHAVIOR_COUNTRY_MAPPING = '{"US": "exclusive"}';

      getValidateMessages.mockReturnValue([]);

      configUtil.readConfiguration();

      expect(getValidateMessages).toHaveBeenCalledWith(
        envValidators,
        expect.objectContaining({
          clientId: '123456789012345678901234',
          clientSecret: '12345678901234567890123456789012',
          projectKey: 'test-project',
          scope: 'test-scope',
          region: 'us-central1.gcp',
          stripeApiToken: 'sk_test_token',
          taxCodeMapping: '{"categories": []}',
          taxBehaviorDefault: 'inclusive',
          countryTaxBehaviorMapping: '{"US": "exclusive"}'
        })
      );
    });
  });
});

