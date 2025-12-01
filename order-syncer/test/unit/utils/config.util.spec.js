import { expect, describe, it, jest, beforeEach, afterEach } from '@jest/globals';
import readConfiguration from '../../../src/utils/config.util.js';
import CustomError from '../../../src/errors/custom.error.js';

// Mock dependencies
jest.mock('../../../src/validators/env-var.validator.js', () => ({
  __esModule: true,
  default: [],
}));

jest.mock('../../../src/validators/helpers.validator.js', () => ({
  getValidateMessages: jest.fn(() => []),
}));

import { getValidateMessages } from '../../../src/validators/helpers.validator.js';

describe('config.util.spec', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('readConfiguration', () => {
    it('should return configuration object with all valid environment variables', () => {
      process.env.CTP_CLIENT_ID = '123456789012345678901234';
      process.env.CTP_CLIENT_SECRET = '12345678901234567890123456789012';
      process.env.CTP_PROJECT_KEY = 'test-project';
      process.env.CTP_SCOPE = 'manage_project';
      process.env.CTP_REGION = 'us-central1.gcp';
      process.env.STRIPE_API_TOKEN = 'sk_test_token';

      getValidateMessages.mockReturnValue([]);

      const config = readConfiguration();

      expect(config).toEqual({
        clientId: '123456789012345678901234',
        clientSecret: '12345678901234567890123456789012',
        projectKey: 'test-project',
        scope: 'manage_project',
        region: 'us-central1.gcp',
        stripeApiToken: 'sk_test_token',
      });
    });

    it('should return configuration with optional scope when not provided', () => {
      process.env.CTP_CLIENT_ID = '123456789012345678901234';
      process.env.CTP_CLIENT_SECRET = '12345678901234567890123456789012';
      process.env.CTP_PROJECT_KEY = 'test-project';
      process.env.CTP_REGION = 'us-central1.gcp';
      process.env.STRIPE_API_TOKEN = 'sk_test_token';
      delete process.env.CTP_SCOPE;

      getValidateMessages.mockReturnValue([]);

      const config = readConfiguration();

      expect(config.scope).toBeUndefined();
    });

    it('should throw CustomError when validation fails', () => {
      process.env.CTP_CLIENT_ID = 'invalid';
      process.env.CTP_CLIENT_SECRET = '12345678901234567890123456789012';
      process.env.CTP_PROJECT_KEY = 'test-project';
      process.env.CTP_REGION = 'us-central1.gcp';
      process.env.STRIPE_API_TOKEN = 'sk_test_token';

      const validationErrors = [
        { code: 'InValidClientId', message: 'Client id should be 24 characters.' },
      ];

      getValidateMessages.mockReturnValue(validationErrors);

      expect(() => readConfiguration()).toThrow(CustomError);

      try {
        readConfiguration();
      } catch (error) {
        expect(error).toBeInstanceOf(CustomError);
        expect(error.statusCode).toBe('InvalidEnvironmentVariablesError');
        expect(error.message).toBe('Invalid Environment Variables please check your .env file');
        expect(error.errors).toEqual(validationErrors);
      }
    });

    it('should throw CustomError with multiple validation errors', () => {
      process.env.CTP_CLIENT_ID = 'invalid';
      process.env.CTP_CLIENT_SECRET = 'invalid';
      process.env.CTP_PROJECT_KEY = 'test-project';
      process.env.CTP_REGION = 'us-central1.gcp';
      process.env.STRIPE_API_TOKEN = 'sk_test_token';

      const validationErrors = [
        { code: 'InValidClientId', message: 'Client id should be 24 characters.' },
        { code: 'InvalidClientSecret', message: 'Client secret should be 32 characters.' },
      ];

      getValidateMessages.mockReturnValue(validationErrors);

      expect(() => readConfiguration()).toThrow(CustomError);

      try {
        readConfiguration();
      } catch (error) {
        expect(error.errors).toEqual(validationErrors);
        expect(error.errors).toHaveLength(2);
      }
    });

    it('should call getValidateMessages with correct parameters', () => {
      process.env.CTP_CLIENT_ID = '123456789012345678901234';
      process.env.CTP_CLIENT_SECRET = '12345678901234567890123456789012';
      process.env.CTP_PROJECT_KEY = 'test-project';
      process.env.CTP_SCOPE = 'manage_project';
      process.env.CTP_REGION = 'us-central1.gcp';
      process.env.STRIPE_API_TOKEN = 'sk_test_token';

      getValidateMessages.mockReturnValue([]);

      readConfiguration();

      expect(getValidateMessages).toHaveBeenCalled();
      const callArgs = getValidateMessages.mock.calls[0];
      expect(callArgs[1]).toHaveProperty('clientId');
      expect(callArgs[1]).toHaveProperty('clientSecret');
      expect(callArgs[1]).toHaveProperty('projectKey');
      expect(callArgs[1]).toHaveProperty('scope');
      expect(callArgs[1]).toHaveProperty('region');
      expect(callArgs[1]).toHaveProperty('stripeApiToken');
    });

    it('should handle different region values', () => {
      const regions = [
        'us-central1.gcp',
        'us-east-2.aws',
        'europe-west1.gcp',
        'eu-central-1.aws',
        'australia-southeast1.gcp',
      ];

      regions.forEach((region) => {
        process.env.CTP_CLIENT_ID = '123456789012345678901234';
        process.env.CTP_CLIENT_SECRET = '12345678901234567890123456789012';
        process.env.CTP_PROJECT_KEY = 'test-project';
        process.env.CTP_REGION = region;
        process.env.STRIPE_API_TOKEN = 'sk_test_token';

        getValidateMessages.mockReturnValue([]);

        const config = readConfiguration();
        expect(config.region).toBe(region);
      });
    });
  });
});

