import { expect, describe, it, jest, beforeEach } from '@jest/globals';
import { ClientBuilder } from '@commercetools/sdk-client-v2';

// Mock dependencies
jest.mock('@commercetools/sdk-client-v2');
jest.mock('../../../src/middlewares/auth.middleware.js', () => ({
  getAuthMiddlewareOptions: jest.fn(),
}));
jest.mock('../../../src/middlewares/http.middleware.js', () => ({
  getHttpMiddlewareOptions: jest.fn(),
}));
jest.mock('../../../src/utils/config.util.js', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import { createClient } from '../../../src/clients/build.client.js';
import { getAuthMiddlewareOptions } from '../../../src/middlewares/auth.middleware.js';
import { getHttpMiddlewareOptions } from '../../../src/middlewares/http.middleware.js';
import readConfiguration from '../../../src/utils/config.util.js';

describe('build.client.spec', () => {
  let mockClientBuilder;
  let mockClient;

  beforeEach(() => {
    jest.clearAllMocks();

    mockClient = {
      execute: jest.fn(),
    };

    mockClientBuilder = {
      withProjectKey: jest.fn().mockReturnThis(),
      withClientCredentialsFlow: jest.fn().mockReturnThis(),
      withHttpMiddleware: jest.fn().mockReturnThis(),
      build: jest.fn().mockReturnValue(mockClient),
    };

    ClientBuilder.mockImplementation(() => mockClientBuilder);

    readConfiguration.mockReturnValue({
      projectKey: 'test-project-key',
    });

    getAuthMiddlewareOptions.mockReturnValue({
      host: 'https://auth.us-central1.gcp.commercetools.com',
      projectKey: 'test-project-key',
      credentials: {
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
      },
      scopes: ['manage_project'],
    });

    getHttpMiddlewareOptions.mockReturnValue({
      host: 'https://api.us-central1.gcp.commercetools.com',
    });
  });

  describe('createClient', () => {
    it('should create a client with correct configuration', () => {
      const client = createClient();

      expect(ClientBuilder).toHaveBeenCalled();
      expect(readConfiguration).toHaveBeenCalled();
      expect(mockClientBuilder.withProjectKey).toHaveBeenCalledWith('test-project-key');
      expect(getAuthMiddlewareOptions).toHaveBeenCalled();
      expect(mockClientBuilder.withClientCredentialsFlow).toHaveBeenCalledWith({
        host: 'https://auth.us-central1.gcp.commercetools.com',
        projectKey: 'test-project-key',
        credentials: {
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret',
        },
        scopes: ['manage_project'],
      });
      expect(getHttpMiddlewareOptions).toHaveBeenCalled();
      expect(mockClientBuilder.withHttpMiddleware).toHaveBeenCalledWith({
        host: 'https://api.us-central1.gcp.commercetools.com',
      });
      expect(mockClientBuilder.build).toHaveBeenCalled();
      expect(client).toBe(mockClient);
    });

    it('should call readConfiguration to get projectKey', () => {
      readConfiguration.mockReturnValue({
        projectKey: 'another-project-key',
      });

      createClient();

      expect(mockClientBuilder.withProjectKey).toHaveBeenCalledWith('another-project-key');
    });
  });
});

