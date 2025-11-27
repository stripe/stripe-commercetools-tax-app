import { expect, describe, it, jest, beforeEach } from '@jest/globals';
import { createApiBuilderFromCtpClient } from '@commercetools/platform-sdk';

// Mock dependencies
jest.mock('@commercetools/platform-sdk', () => ({
  createApiBuilderFromCtpClient: jest.fn(),
}));
jest.mock('../../../src/clients/build.client.js', () => ({
  createClient: jest.fn(),
}));
jest.mock('../../../src/utils/config.util.js', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import { createClient } from '../../../src/clients/build.client.js';
import readConfiguration from '../../../src/utils/config.util.js';
import { createApiRoot, getProject } from '../../../src/clients/create.client.js';

describe('create.client.spec', () => {
  let mockClient;
  let mockApiBuilder;
  let mockApiRoot;

  beforeEach(() => {
    jest.clearAllMocks();

    mockClient = {
      execute: jest.fn(),
    };

    // Create mockApiRoot with proper chainable methods
    // get() will be configured per test as needed
    mockApiRoot = {
      get: jest.fn(),
      execute: jest.fn(),
    };

    mockApiBuilder = {
      withProjectKey: jest.fn().mockReturnValue(mockApiRoot),
    };

    createClient.mockReturnValue(mockClient);
    createApiBuilderFromCtpClient.mockReturnValue(mockApiBuilder);
    readConfiguration.mockReturnValue({
      projectKey: 'test-project-key',
    });
  });

  describe('createApiRoot', () => {
    it('should create apiRoot on first call (when root is null - lines 14-18)', () => {
      const result = createApiRoot();

      expect(createClient).toHaveBeenCalled();
      expect(createApiBuilderFromCtpClient).toHaveBeenCalledWith(mockClient);
      expect(readConfiguration).toHaveBeenCalled();
      expect(mockApiBuilder.withProjectKey).toHaveBeenCalledWith({
        projectKey: 'test-project-key',
      });
      // The result should be the mockApiRoot returned by withProjectKey
      expect(result).toBe(mockApiRoot);
    });

    it('should reuse apiRoot on subsequent calls (when root exists - lines 10-12)', () => {
      const firstCall = createApiRoot();
      
      // Clear mocks to verify second call doesn't recreate
      jest.clearAllMocks();
      readConfiguration.mockReturnValue({
        projectKey: 'test-project-key',
      });
      
      const secondCall = createApiRoot();

      // Should not create client again (closure reuses root - line 10-11)
      expect(createClient).not.toHaveBeenCalled();
      expect(createApiBuilderFromCtpClient).not.toHaveBeenCalled();
      // Both calls should return the same object (closure reuses root)
      expect(firstCall).toBe(secondCall);
    });
  });

  describe('getProject', () => {
    it('should get project details successfully', async () => {
      const mockProjectResponse = {
        body: {
          key: 'test-project-key',
          version: 1,
        },
      };

      // Setup the chain: get() returns an object with execute()
      const mockGetRequest = {
        execute: jest.fn().mockResolvedValue(mockProjectResponse),
      };

      // The mockApiRoot was already created in previous tests via createApiRoot()
      // We need to reconfigure its get() method for this test
      // Since createApiRoot() returns the same object (closure), we can reconfigure it
      const apiRoot = createApiRoot(); // Get the existing apiRoot
      apiRoot.get.mockReturnValue(mockGetRequest);

      const result = await getProject();

      expect(apiRoot.get).toHaveBeenCalled();
      expect(mockGetRequest.execute).toHaveBeenCalled();
      expect(result).toEqual(mockProjectResponse);
    });

    it('should handle errors when getting project', async () => {
      const error = new Error('Failed to get project');
      const mockGetRequest = {
        execute: jest.fn().mockRejectedValue(error),
      };

      // Get the existing apiRoot and reconfigure get()
      const apiRoot = createApiRoot();
      apiRoot.get.mockReturnValue(mockGetRequest);

      await expect(getProject()).rejects.toThrow('Failed to get project');
      expect(apiRoot.get).toHaveBeenCalled();
      expect(mockGetRequest.execute).toHaveBeenCalled();
    });
  });
});

