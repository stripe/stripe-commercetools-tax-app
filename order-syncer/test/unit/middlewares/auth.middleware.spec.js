import { expect, describe, it, jest, beforeEach } from '@jest/globals';

// Mock dependencies
jest.mock('../../../src/utils/config.util.js', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import readConfiguration from '../../../src/utils/config.util.js';
import { getAuthMiddlewareOptions } from '../../../src/middlewares/auth.middleware.js';

describe('auth.middleware.spec', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getAuthMiddlewareOptions', () => {
    it('should return auth middleware options with all configuration', () => {
      readConfiguration.mockReturnValue({
        region: 'us-central1.gcp',
        projectKey: 'test-project-key',
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        scope: 'manage_project:test-project',
      });

      const result = getAuthMiddlewareOptions();

      expect(readConfiguration).toHaveBeenCalled();
      expect(result).toEqual({
        host: 'https://auth.us-central1.gcp.commercetools.com',
        projectKey: 'test-project-key',
        credentials: {
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret',
        },
        scopes: ['manage_project:test-project'],
      });
    });

    it('should use default scope when scope is not provided', () => {
      readConfiguration.mockReturnValue({
        region: 'europe-west1.gcp',
        projectKey: 'test-project-key',
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        scope: undefined,
      });

      const result = getAuthMiddlewareOptions();

      expect(result.scopes).toEqual(['default']);
    });

    it('should use default scope when scope is null', () => {
      readConfiguration.mockReturnValue({
        region: 'us-east-2.aws',
        projectKey: 'test-project-key',
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        scope: null,
      });

      const result = getAuthMiddlewareOptions();

      expect(result.scopes).toEqual(['default']);
    });

    it('should use default scope when scope is empty string', () => {
      readConfiguration.mockReturnValue({
        region: 'eu-central-1.aws',
        projectKey: 'test-project-key',
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        scope: '',
      });

      const result = getAuthMiddlewareOptions();

      expect(result.scopes).toEqual(['default']);
    });

    it('should handle different regions correctly', () => {
      const regions = [
        'us-central1.gcp',
        'us-east-2.aws',
        'europe-west1.gcp',
        'eu-central-1.aws',
        'australia-southeast1.gcp',
      ];

      regions.forEach((region) => {
        readConfiguration.mockReturnValue({
          region: region,
          projectKey: 'test-project-key',
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret',
          scope: 'manage_project',
        });

        const result = getAuthMiddlewareOptions();

        expect(result.host).toBe(`https://auth.${region}.commercetools.com`);
      });
    });
  });
});

