import { expect, describe, it, jest, beforeEach, afterEach } from '@jest/globals';

// Mock the dependencies
jest.mock('../../../src/clients/create.client.js', () => ({
  createApiRoot: jest.fn()
}));

jest.mock('../../../src/connectors/action.js', () => ({
  createCTPExtension: jest.fn(),
  createCustomTypes: jest.fn()
}));

jest.mock('../../../src/validators/stripeTaxValidator.js', () => ({
  validateStripeTax: jest.fn()
}));

import { createApiRoot } from '../../../src/clients/create.client.js';
import { createCTPExtension } from '../../../src/connectors/action.js';
import { validateStripeTax } from '../../../src/validators/stripeTaxValidator.js';
import {
  CONNECT_SERVICE_URL,
  CTP_TAX_CALCULATOR_EXTENSION_KEY,
  TAX_PROVIDER_API_TOKEN,
} from '../../../src/connectors/constants.js';

// Import the module under test
import { postDeploy, run } from '../../../src/connectors/post-deploy.js';

describe('post-deploy.spec', () => {
  let mockApiRoot;
  let originalProcessEnv;
  let originalExitCode;

  beforeEach(() => {
    // Store original values
    originalProcessEnv = process.env;
    originalExitCode = process.exitCode;

    // Reset all mocks
    jest.clearAllMocks();

    // Setup mock API root
    mockApiRoot = { mock: 'apiRoot' };
    createApiRoot.mockReturnValue(mockApiRoot);

    // Reset process.exitCode
    process.exitCode = 0;
  });

  afterEach(() => {
    // Restore original values
    process.env = originalProcessEnv;
    process.exitCode = originalExitCode;
  });

  describe('postDeploy function', () => {
    it('should execute successfully with valid properties', async () => {
      // Arrange
      const properties = new Map([
        [CONNECT_SERVICE_URL, 'https://example.com'],
        [TAX_PROVIDER_API_TOKEN, 'sk_test_token']
      ]);

      validateStripeTax.mockResolvedValue();
      createCTPExtension.mockResolvedValue();

      // Act
      await postDeploy(properties);

      // Assert
      expect(validateStripeTax).toHaveBeenCalledWith('sk_test_token');
      expect(createApiRoot).toHaveBeenCalled();
      expect(createCTPExtension).toHaveBeenCalledWith(
        mockApiRoot,
        CTP_TAX_CALCULATOR_EXTENSION_KEY,
        'https://example.com'
      );
    });

    it('should throw error when TAX_PROVIDER_API_TOKEN is missing', async () => {
      // Arrange
      const properties = new Map([
        [CONNECT_SERVICE_URL, 'https://example.com']
        // TAX_PROVIDER_API_TOKEN is missing
      ]);

      // Act & Assert
      await expect(postDeploy(properties))
        .rejects
        .toThrow(`${TAX_PROVIDER_API_TOKEN} is required for Stripe Tax validation`);

      expect(validateStripeTax).not.toHaveBeenCalled();
      expect(createCTPExtension).not.toHaveBeenCalled();
    });

    it('should throw error when CONNECT_SERVICE_URL is missing', async () => {
      // Arrange
      const properties = new Map([
        [TAX_PROVIDER_API_TOKEN, 'sk_test_token']
        // CONNECT_SERVICE_URL is missing
      ]);

      // Act & Assert
      await expect(postDeploy(properties))
        .rejects
        .toThrow(`${CONNECT_SERVICE_URL} is required for extension creation`);

      expect(validateStripeTax).not.toHaveBeenCalled();
      expect(createCTPExtension).not.toHaveBeenCalled();
    });

    it('should throw error when both required properties are missing', async () => {
      // Arrange
      const properties = new Map([]);

      // Act & Assert
      await expect(postDeploy(properties))
        .rejects
        .toThrow(`${TAX_PROVIDER_API_TOKEN} is required for Stripe Tax validation`);

      expect(validateStripeTax).not.toHaveBeenCalled();
      expect(createCTPExtension).not.toHaveBeenCalled();
    });

    it('should throw error when Stripe Tax validation fails', async () => {
      // Arrange
      const properties = new Map([
        [CONNECT_SERVICE_URL, 'https://example.com'],
        [TAX_PROVIDER_API_TOKEN, 'sk_test_token']
      ]);

      const validationError = new Error('Stripe Tax validation failed');
      validateStripeTax.mockRejectedValue(validationError);

      // Act & Assert
      await expect(postDeploy(properties))
        .rejects
        .toThrow('Stripe Tax validation failed');

      expect(validateStripeTax).toHaveBeenCalledWith('sk_test_token');
      expect(createCTPExtension).not.toHaveBeenCalled();
    });

    it('should throw error when CTP extension creation fails', async () => {
      // Arrange
      const properties = new Map([
        [CONNECT_SERVICE_URL, 'https://example.com'],
        [TAX_PROVIDER_API_TOKEN, 'sk_test_token']
      ]);

      validateStripeTax.mockResolvedValue();
      const extensionError = new Error('Extension creation failed');
      createCTPExtension.mockRejectedValue(extensionError);

      // Act & Assert
      await expect(postDeploy(properties))
        .rejects
        .toThrow('Extension creation failed');

      expect(validateStripeTax).toHaveBeenCalledWith('sk_test_token');
      expect(createApiRoot).toHaveBeenCalled();
      expect(createCTPExtension).toHaveBeenCalledWith(
        mockApiRoot,
        CTP_TAX_CALCULATOR_EXTENSION_KEY,
        'https://example.com'
      );
    });

    it('should handle empty string values for required properties', async () => {
      // Arrange
      const properties = new Map([
        [CONNECT_SERVICE_URL, ''],
        [TAX_PROVIDER_API_TOKEN, '']
      ]);

      // Act & Assert
      await expect(postDeploy(properties))
        .rejects
        .toThrow(`${TAX_PROVIDER_API_TOKEN} is required for Stripe Tax validation`);

      expect(validateStripeTax).not.toHaveBeenCalled();
      expect(createCTPExtension).not.toHaveBeenCalled();
    });

    it('should handle null values for required properties', async () => {
      // Arrange
      const properties = new Map([
        [CONNECT_SERVICE_URL, null],
        [TAX_PROVIDER_API_TOKEN, null]
      ]);

      // Act & Assert
      await expect(postDeploy(properties))
        .rejects
        .toThrow(`${TAX_PROVIDER_API_TOKEN} is required for Stripe Tax validation`);

      expect(validateStripeTax).not.toHaveBeenCalled();
      expect(createCTPExtension).not.toHaveBeenCalled();
    });

    it('should handle undefined values for required properties', async () => {
      // Arrange
      const properties = new Map([
        [CONNECT_SERVICE_URL, undefined],
        [TAX_PROVIDER_API_TOKEN, undefined]
      ]);

      // Act & Assert
      await expect(postDeploy(properties))
        .rejects
        .toThrow(`${TAX_PROVIDER_API_TOKEN} is required for Stripe Tax validation`);

      expect(validateStripeTax).not.toHaveBeenCalled();
      expect(createCTPExtension).not.toHaveBeenCalled();
    });
  });

  describe('run function', () => {
    it('should execute successfully and not set exit code when postDeploy succeeds', async () => {
      // Arrange
      process.env = {
        [CONNECT_SERVICE_URL]: 'https://example.com',
        [TAX_PROVIDER_API_TOKEN]: 'sk_test_token'
      };

      validateStripeTax.mockResolvedValue();
      createCTPExtension.mockResolvedValue();

      // Act
      await run();

      // Assert
      expect(validateStripeTax).toHaveBeenCalledWith('sk_test_token');
      expect(createCTPExtension).toHaveBeenCalled();
      expect(process.exitCode).toBe(0);
    });

    it('should set exit code to 1 when postDeploy fails', async () => {
      // Arrange
      process.env = {
        [CONNECT_SERVICE_URL]: 'https://example.com',
        [TAX_PROVIDER_API_TOKEN]: 'sk_test_token'
      };

      const error = new Error('Test error');
      validateStripeTax.mockRejectedValue(error);

      // Act
      await run();

      // Assert
      expect(process.exitCode).toBe(1);
    });

    it('should handle missing environment variables in run function', async () => {
      // Arrange
      process.env = {};

      // Act
      await run();

      // Assert
      expect(process.exitCode).toBe(1);
    });

    it('should handle partial environment variables in run function', async () => {
      // Arrange
      process.env = {
        [CONNECT_SERVICE_URL]: 'https://example.com'
        // TAX_PROVIDER_API_TOKEN is missing
      };

      // Act
      await run();

      // Assert
      expect(process.exitCode).toBe(1);
    });
  });
});
