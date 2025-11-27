import { expect, describe, it, jest, beforeEach, afterEach } from '@jest/globals';
import { getAuthMiddlewareOptions } from '../../../src/middlewares/auth.middleware.js';

// Mock dependencies
jest.mock('../../../src/utils/config.util.js', () => ({
  __esModule: true,
  default: {
    readConfiguration: jest.fn()
  }
}));

import configUtils from '../../../src/utils/config.util.js';

describe('auth.middleware', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getAuthMiddlewareOptions', () => {
    it('should return auth middleware options with scope when config.scope is set', () => {
      const mockConfig = {
        region: 'us-central1',
        projectKey: 'test-project',
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        scope: 'manage:test'
      };

      configUtils.readConfiguration.mockReturnValue(mockConfig);

      const result = getAuthMiddlewareOptions();

      expect(result).toEqual({
        host: 'https://auth.us-central1.commercetools.com',
        projectKey: 'test-project',
        credentials: {
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret'
        },
        scopes: ['manage:test']
      });
    });

    it('should return auth middleware options with default scope when config.scope is not set', () => {
      const mockConfig = {
        region: 'europe-west1',
        projectKey: 'test-project-2',
        clientId: 'test-client-id-2',
        clientSecret: 'test-client-secret-2',
        scope: null
      };

      configUtils.readConfiguration.mockReturnValue(mockConfig);

      const result = getAuthMiddlewareOptions();

      expect(result).toEqual({
        host: 'https://auth.europe-west1.commercetools.com',
        projectKey: 'test-project-2',
        credentials: {
          clientId: 'test-client-id-2',
          clientSecret: 'test-client-secret-2'
        },
        scopes: ['default']
      });
    });

    it('should return auth middleware options with default scope when config.scope is undefined', () => {
      const mockConfig = {
        region: 'us-east-2',
        projectKey: 'test-project-3',
        clientId: 'test-client-id-3',
        clientSecret: 'test-client-secret-3'
        // scope is undefined
      };

      configUtils.readConfiguration.mockReturnValue(mockConfig);

      const result = getAuthMiddlewareOptions();

      expect(result.scopes).toEqual(['default']);
    });

    it('should handle different regions correctly', () => {
      const regions = ['us-central1', 'us-east-2', 'europe-west1', 'eu-central-1', 'australia-southeast1'];

      regions.forEach(region => {
        const mockConfig = {
          region,
          projectKey: 'test-project',
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret',
          scope: 'default'
        };

        configUtils.readConfiguration.mockReturnValue(mockConfig);

        const result = getAuthMiddlewareOptions();

        expect(result.host).toBe(`https://auth.${region}.commercetools.com`);
      });
    });
  });
});

