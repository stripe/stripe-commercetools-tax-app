import { expect, describe, it, beforeEach, afterEach } from '@jest/globals';
import { loadConfig } from '../../../../../src/extensions/stripe/configurations/config.js';

describe('stripe-config.spec', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('loadConfig', () => {
    it('should return config object when STRIPE_API_TOKEN is set', () => {
      process.env.STRIPE_API_TOKEN = 'sk_test_token_12345';

      const config = loadConfig();

      expect(config).toEqual({
        taxProviderApiToken: 'sk_test_token_12345',
      });
    });

    it('should return config with different token values', () => {
      process.env.STRIPE_API_TOKEN = 'sk_live_token_67890';

      const config = loadConfig();

      expect(config).toEqual({
        taxProviderApiToken: 'sk_live_token_67890',
      });
    });

    it('should throw error when STRIPE_API_TOKEN is not provided', () => {
      delete process.env.STRIPE_API_TOKEN;

      expect(() => loadConfig()).toThrow('Tax provider API token is not provided.');
    });

    it('should throw error when STRIPE_API_TOKEN is empty string', () => {
      process.env.STRIPE_API_TOKEN = '';

      expect(() => loadConfig()).toThrow('Tax provider API token is not provided.');
    });

    it('should throw error when STRIPE_API_TOKEN is undefined', () => {
      process.env.STRIPE_API_TOKEN = undefined;

      expect(() => loadConfig()).toThrow('Tax provider API token is not provided.');
    });
  });
});

