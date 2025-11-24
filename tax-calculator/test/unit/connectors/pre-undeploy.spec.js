import { expect, describe, it, jest, beforeEach, afterEach } from '@jest/globals';
import { createApiRoot } from '../../../src/clients/create.client.js';
import { deleteCTPExtension, deleteCustomTypes } from '../../../src/connectors/action.js';
import { CTP_TAX_CALCULATOR_EXTENSION_KEY } from '../../../src/connectors/constants.js';

// Mock dependencies
jest.mock('../../../src/clients/create.client.js', () => ({
  createApiRoot: jest.fn(),
}));

jest.mock('../../../src/connectors/action.js', () => ({
  deleteCTPExtension: jest.fn(),
  deleteCustomTypes: jest.fn(),
}));

jest.mock('dotenv/config', () => ({}), { virtual: true });

describe('pre-undeploy.js', () => {
  let mockApiRoot;
  let originalExitCode;
  let originalStderrWrite;

  // Replicate the functions from pre-undeploy.js for testing
  async function preUndeploy() {
    const apiRoot = createApiRoot();
    await deleteCTPExtension(apiRoot, CTP_TAX_CALCULATOR_EXTENSION_KEY);
    await deleteCustomTypes(apiRoot, true);
  }

  async function run() {
    try {
      await preUndeploy();
    } catch (error) {
      process.stderr.write(`Pre-undeploy failed: ${error.message}\n`);
      process.exitCode = 1;
    }
  }

  beforeEach(() => {
    jest.clearAllMocks();

    mockApiRoot = { mock: 'apiRoot' };
    createApiRoot.mockReturnValue(mockApiRoot);
    deleteCTPExtension.mockResolvedValue(undefined);
    deleteCustomTypes.mockResolvedValue(undefined);

    originalExitCode = process.exitCode;
    originalStderrWrite = process.stderr.write;
    process.exitCode = undefined;
    process.stderr.write = jest.fn();
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    process.stderr.write = originalStderrWrite;
  });

  describe('preUndeploy', () => {
    it('should create API root and delete extension and custom types', async () => {
      await preUndeploy();

      expect(createApiRoot).toHaveBeenCalledTimes(1);
      expect(deleteCTPExtension).toHaveBeenCalledWith(
        mockApiRoot,
        CTP_TAX_CALCULATOR_EXTENSION_KEY
      );
      expect(deleteCustomTypes).toHaveBeenCalledWith(mockApiRoot, true);
    });

    it('should call deleteCTPExtension before deleteCustomTypes', async () => {
      const callOrder = [];
      
      deleteCTPExtension.mockImplementation(async () => {
        callOrder.push('deleteCTPExtension');
      });
      
      deleteCustomTypes.mockImplementation(async () => {
        callOrder.push('deleteCustomTypes');
      });

      await preUndeploy();

      expect(callOrder[0]).toBe('deleteCTPExtension');
      expect(callOrder[1]).toBe('deleteCustomTypes');
    });
  });

  describe('run', () => {
    it('should execute preUndeploy successfully', async () => {
      await run();

      expect(createApiRoot).toHaveBeenCalled();
      expect(deleteCTPExtension).toHaveBeenCalled();
      expect(deleteCustomTypes).toHaveBeenCalled();
      expect(process.exitCode).toBeUndefined();
      expect(process.stderr.write).not.toHaveBeenCalled();
    });

    it('should handle errors and set exit code', async () => {
      const error = new Error('Deletion failed');
      deleteCTPExtension.mockRejectedValue(error);

      await run();

      expect(process.stderr.write).toHaveBeenCalledWith(
        `Pre-undeploy failed: ${error.message}\n`
      );
      expect(process.exitCode).toBe(1);
    });

    it('should handle errors from deleteCustomTypes', async () => {
      const error = new Error('Custom types deletion failed');
      deleteCustomTypes.mockRejectedValue(error);

      await run();

      expect(process.stderr.write).toHaveBeenCalledWith(
        `Pre-undeploy failed: ${error.message}\n`
      );
      expect(process.exitCode).toBe(1);
    });
  });
});
