import { expect, describe, it, jest, beforeEach } from '@jest/globals';
import {
  createCTPExtension,
  deleteCTPExtension,
  validateTaxCodeMapping,
  createCustomTypes,
  deleteCustomTypes,
  validateCustomTypes,
} from '../../../src/connectors/action.js';

// Mock dependencies
jest.mock('../../../src/utils/logger.utils.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('serialize-error', () => ({
  serializeError: jest.fn((err) => ({
    message: err.message,
    stack: err.stack,
  })),
}));

jest.mock('../../../src/connectors/customTypes.js', () => ({
  ALL_CUSTOM_TYPES: [
    {
      key: 'test-custom-type-1',
      resourceTypeIds: ['product-price'],
      fieldDefinitions: [
        {
          name: 'connectorStripeTax_TaxCode',
          type: { name: 'String' },
        },
      ],
    },
  ],
  TAX_CODE_CUSTOM_TYPE_NAME: 'connectorStripeTax_TaxCode',
}));

jest.mock('../../../resources/api-extension.json', () => ({
  default: {
    key: '${ctpTaxCalculatorExtensionKey}',
    destination: {
      type: 'HTTP',
      url: '${ctpExtensionBaseUrl}',
    },
    triggers: [],
  },
}), { virtual: true });

import { logger } from '../../../src/utils/logger.utils.js';

describe('action.js', () => {
  let mockApiRoot;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock functions that can be reassigned per test
    const createMockExtensions = () => {
      const mockGet = jest.fn();
      const mockPost = jest.fn();
      const mockWithIdPost = jest.fn();
      const mockWithKeyDelete = jest.fn();

      return {
        get: jest.fn(() => ({ execute: mockGet })),
        post: jest.fn(() => ({ execute: mockPost })),
        withId: jest.fn(() => ({ 
          post: jest.fn(() => ({ execute: mockWithIdPost }))
        })),
        withKey: jest.fn(() => ({ 
          delete: jest.fn(() => ({ execute: mockWithKeyDelete }))
        })),
        _mockGet: mockGet,
        _mockPost: mockPost,
        _mockWithIdPost: mockWithIdPost,
        _mockWithKeyDelete: mockWithKeyDelete,
      };
    };

    const createMockCategories = () => {
      const mockGet = jest.fn();
      return {
        get: jest.fn(() => ({ execute: mockGet })),
        _mockGet: mockGet,
      };
    };

    const createMockTypes = () => {
      const mockGet = jest.fn();
      const mockPost = jest.fn();
      const mockWithKeyPost = jest.fn();
      const mockWithKeyDelete = jest.fn();

      return {
        get: jest.fn(() => ({ execute: mockGet })),
        post: jest.fn(() => ({ execute: mockPost })),
        withKey: jest.fn(() => ({
          post: jest.fn(() => ({ execute: mockWithKeyPost })),
          delete: jest.fn(() => ({ execute: mockWithKeyDelete })),
        })),
        _mockGet: mockGet,
        _mockPost: mockPost,
        _mockWithKeyPost: mockWithKeyPost,
        _mockWithKeyDelete: mockWithKeyDelete,
      };
    };

    const extensionsMock = createMockExtensions();
    const categoriesMock = createMockCategories();
    const typesMock = createMockTypes();

    mockApiRoot = {
      extensions: jest.fn(() => extensionsMock),
      categories: jest.fn(() => categoriesMock),
      types: jest.fn(() => typesMock),
      _extensionsMock: extensionsMock,
      _categoriesMock: categoriesMock,
      _typesMock: typesMock,
    };
  });

  describe('createCTPExtension', () => {
    const extensionKey = 'test-extension-key';
    const extensionBaseUrl = 'https://example.com/webhook';

    it('should create a new extension when it does not exist', async () => {
      mockApiRoot._extensionsMock._mockGet.mockResolvedValue({
        body: { results: [] },
      });
      mockApiRoot._extensionsMock._mockPost.mockResolvedValue({});

      await createCTPExtension(mockApiRoot, extensionKey, extensionBaseUrl);

      expect(mockApiRoot._extensionsMock._mockGet).toHaveBeenCalled();
      expect(mockApiRoot._extensionsMock._mockPost).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Successfully created an API extension')
      );
    });

    it('should delete and recreate an existing extension when it exists', async () => {
      const existingExtension = {
        id: 'ext-123',
        version: 1,
        destination: { type: 'HTTP', url: 'https://old-url.com' },
        triggers: [],
      };

      mockApiRoot._extensionsMock._mockGet.mockResolvedValue({
        body: { results: [existingExtension] },
      });
      mockApiRoot._extensionsMock._mockWithKeyDelete.mockResolvedValue({});
      mockApiRoot._extensionsMock._mockPost.mockResolvedValue({});

      await createCTPExtension(mockApiRoot, extensionKey, extensionBaseUrl);

      expect(mockApiRoot._extensionsMock._mockWithKeyDelete).toHaveBeenCalled();
      expect(mockApiRoot._extensionsMock._mockPost).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Deleted existing API extension')
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Successfully created an API extension')
      );
    });

    it('should delete and recreate extension even when it matches existing configuration', async () => {
      const existingExtension = {
        id: 'ext-123',
        version: 1,
        destination: { type: 'HTTP', url: extensionBaseUrl },
        triggers: [],
      };

      mockApiRoot._extensionsMock._mockGet.mockResolvedValue({
        body: { results: [existingExtension] },
      });
      mockApiRoot._extensionsMock._mockWithKeyDelete.mockResolvedValue({});
      mockApiRoot._extensionsMock._mockPost.mockResolvedValue({});

      await createCTPExtension(mockApiRoot, extensionKey, extensionBaseUrl);

      expect(mockApiRoot._extensionsMock._mockWithKeyDelete).toHaveBeenCalled();
      expect(mockApiRoot._extensionsMock._mockPost).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Deleted existing API extension')
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Successfully created an API extension')
      );
    });

    it('should throw error when extension creation fails', async () => {
      const error = new Error('API error');

      mockApiRoot._extensionsMock._mockGet.mockRejectedValue(error);

      await expect(
        createCTPExtension(mockApiRoot, extensionKey, extensionBaseUrl)
      ).rejects.toThrow('Failed to sync API extension');
    });
  });

  describe('deleteCTPExtension', () => {
    const extensionKey = 'test-extension-key';

    it('should delete an existing extension', async () => {
      const existingExtension = {
        id: 'ext-123',
        version: 1,
      };

      mockApiRoot._extensionsMock._mockGet.mockResolvedValue({
        body: { results: [existingExtension] },
      });
      mockApiRoot._extensionsMock._mockWithKeyDelete.mockResolvedValue({});

      await deleteCTPExtension(mockApiRoot, extensionKey);

      expect(mockApiRoot._extensionsMock._mockWithKeyDelete).toHaveBeenCalled();
    });

    it('should log info when extension does not exist', async () => {
      mockApiRoot._extensionsMock._mockGet.mockResolvedValue({
        body: { results: [] },
      });

      await deleteCTPExtension(mockApiRoot, extensionKey);

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('No API extension found')
      );
    });
  });

  describe('validateTaxCodeMapping', () => {
    it('should pass validation for empty mapping', async () => {
      await validateTaxCodeMapping(mockApiRoot, null);

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('TAX_CODE_CATEGORY_MAPPING_JSON is empty')
      );
    });

    it('should pass validation for mapping with no categories', async () => {
      await validateTaxCodeMapping(mockApiRoot, { categories: [] });

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('TAX_CODE_CATEGORY_MAPPING_JSON is empty')
      );
    });

    it('should validate all categories successfully', async () => {
      const mapping = {
        categories: [
          {
            ctCategory: { id: 'cat-1' },
            taxCode: 'txcd_123',
          },
          {
            ctCategory: { key: 'category-key' },
            taxCode: 'txcd_456',
          },
        ],
      };

      mockApiRoot._categoriesMock._mockGet
        .mockResolvedValueOnce({
          body: { results: [{ id: 'cat-1' }] },
        })
        .mockResolvedValueOnce({
          body: { results: [{ key: 'category-key' }] },
        });

      await validateTaxCodeMapping(mockApiRoot, mapping);

      expect(mockApiRoot._categoriesMock._mockGet).toHaveBeenCalledTimes(2);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('All 2 category mappings validated successfully')
      );
    });

    it('should throw error when category does not exist', async () => {
      const mapping = {
        categories: [
          {
            ctCategory: { id: 'non-existent' },
            taxCode: 'txcd_123',
          },
        ],
      };

      mockApiRoot._categoriesMock._mockGet.mockResolvedValue({
        body: { results: [] },
      });

      await expect(validateTaxCodeMapping(mockApiRoot, mapping)).rejects.toThrow(
        'Category validation failed'
      );
    });

    it('should throw error when ctCategory is invalid', async () => {
      const mapping = {
        categories: [
          {
            ctCategory: 'invalid',
            taxCode: 'txcd_123',
          },
        ],
      };

      await expect(validateTaxCodeMapping(mockApiRoot, mapping)).rejects.toThrow(
        'ctCategory must be an object'
      );
    });

    it('should throw error when ctCategory has no id or key', async () => {
      const mapping = {
        categories: [
          {
            ctCategory: {},
            taxCode: 'txcd_123',
          },
        ],
      };

      await expect(validateTaxCodeMapping(mockApiRoot, mapping)).rejects.toThrow(
        'ctCategory must have either "id" or "key"'
      );
    });
  });

  describe('createCustomTypes', () => {
    it('should create all custom types successfully', async () => {
      mockApiRoot._typesMock._mockGet.mockResolvedValue({
        body: { results: [] },
      });
      mockApiRoot._typesMock._mockPost.mockResolvedValue({});

      await createCustomTypes(mockApiRoot);

      expect(mockApiRoot._typesMock._mockPost).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('All custom types created successfully')
      );
    });

    it('should update existing custom type with new field definitions', async () => {
      const existingType = {
        key: 'test-custom-type-1',
        version: 1,
        resourceTypeIds: ['product-price'],
        fieldDefinitions: [],
      };

      mockApiRoot._typesMock._mockGet.mockResolvedValue({
        body: { results: [existingType] },
      });
      mockApiRoot._typesMock._mockWithKeyPost.mockResolvedValue({});

      await createCustomTypes(mockApiRoot);

      expect(mockApiRoot._typesMock._mockWithKeyPost).toHaveBeenCalled();
    });

    it('should throw error when custom type creation fails', async () => {
      const error = new Error('Creation failed');
      mockApiRoot._typesMock._mockGet.mockRejectedValue(error);

      await expect(createCustomTypes(mockApiRoot)).rejects.toThrow(
        'Custom type creation or field definitions related with Stripe Tax Connector creation failed'
      );
    });
  });

  describe('deleteCustomTypes', () => {
    it('should skip cleanup when cleanupCustomTypes is false', async () => {
      await deleteCustomTypes(mockApiRoot, false);

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Custom type cleanup disabled')
      );
    });

    it('should delete custom types when cleanupCustomTypes is true', async () => {
      const existingType = {
        key: 'test-custom-type-1',
        version: 1,
        resourceTypeIds: ['product-price'],
        fieldDefinitions: [
          {
            name: 'connectorStripeTax_TaxCode',
          },
        ],
      };

      mockApiRoot._typesMock._mockGet.mockResolvedValue({
        body: { results: [existingType] },
      });
      mockApiRoot._typesMock._mockWithKeyDelete.mockResolvedValue({});

      await deleteCustomTypes(mockApiRoot, true);

      expect(mockApiRoot._typesMock._mockWithKeyDelete).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Custom type cleanup completed')
      );
    });

    it('should update type when it has multiple field definitions', async () => {
      const existingType = {
        key: 'test-custom-type-1',
        version: 1,
        resourceTypeIds: ['product-price'],
        fieldDefinitions: [
          {
            name: 'connectorStripeTax_TaxCode',
          },
          {
            name: 'otherField',
          },
        ],
      };

      mockApiRoot._typesMock._mockGet.mockResolvedValue({
        body: { results: [existingType] },
      });
      mockApiRoot._typesMock._mockWithKeyPost.mockResolvedValue({});

      await deleteCustomTypes(mockApiRoot, true);

      expect(mockApiRoot._typesMock._mockWithKeyPost).toHaveBeenCalled();
    });
  });

  describe('validateCustomTypes', () => {
    it('should return valid result when all custom types exist and are properly configured', async () => {
      const existingType = {
        key: 'test-custom-type-1',
        resourceTypeIds: ['product-price'],
        fieldDefinitions: [
          {
            name: 'connectorStripeTax_TaxCode',
          },
        ],
      };

      mockApiRoot._typesMock._mockGet.mockResolvedValue({
        body: { results: [existingType] },
      });

      const result = await validateCustomTypes(mockApiRoot);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.customTypes).toHaveLength(1);
      expect(result.customTypes[0].exists).toBe(true);
      expect(result.customTypes[0].hasRequiredField).toBe(true);
    });

    it('should return invalid result when custom type does not exist', async () => {
      mockApiRoot._typesMock._mockGet.mockResolvedValue({
        body: { results: [] },
      });

      const result = await validateCustomTypes(mockApiRoot);

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('does not exist');
    });

    it('should return invalid result when custom type is missing required field', async () => {
      const existingType = {
        key: 'test-custom-type-1',
        resourceTypeIds: ['product-price'],
        fieldDefinitions: [
          {
            name: 'otherField',
          },
        ],
      };

      mockApiRoot._typesMock._mockGet.mockResolvedValue({
        body: { results: [existingType] },
      });

      const result = await validateCustomTypes(mockApiRoot);

      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain('missing required field');
    });

    it('should handle validation errors gracefully', async () => {
      const error = new Error('API error');
      mockApiRoot._typesMock._mockGet.mockRejectedValue(error);

      const result = await validateCustomTypes(mockApiRoot);

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Failed to validate custom type');
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('createCTPExtension - edge cases', () => {
    it('should throw error when ctpExtensionBaseUrl is missing', async () => {
      await expect(
        createCTPExtension(mockApiRoot, 'test-key', null)
      ).rejects.toThrow('ctpExtensionBaseUrl is required');

      await expect(
        createCTPExtension(mockApiRoot, 'test-key', undefined)
      ).rejects.toThrow('ctpExtensionBaseUrl is required');

      await expect(
        createCTPExtension(mockApiRoot, 'test-key', '')
      ).rejects.toThrow('ctpExtensionBaseUrl is required');
    });

    it('should handle error when extension deletion fails', async () => {
      const existingExtension = {
        id: 'ext-123',
        version: 1
      };

      mockApiRoot._extensionsMock._mockGet.mockResolvedValue({
        body: { results: [existingExtension] }
      });
      mockApiRoot._extensionsMock._mockWithKeyDelete.mockRejectedValue(
        new Error('Delete failed')
      );

      await expect(
        createCTPExtension(mockApiRoot, 'test-key', 'https://example.com')
      ).rejects.toThrow('Failed to sync API extension');
    });

    it('should handle error when extension creation fails after deletion', async () => {
      const existingExtension = {
        id: 'ext-123',
        version: 1
      };

      mockApiRoot._extensionsMock._mockGet.mockResolvedValue({
        body: { results: [existingExtension] }
      });
      mockApiRoot._extensionsMock._mockWithKeyDelete.mockResolvedValue({});
      mockApiRoot._extensionsMock._mockPost.mockRejectedValue(
        new Error('Creation failed')
      );

      await expect(
        createCTPExtension(mockApiRoot, 'test-key', 'https://example.com')
      ).rejects.toThrow('Failed to sync API extension');
    });
  });

  describe('validateTaxCodeMapping - edge cases', () => {
    it('should handle error when category query fails', async () => {
      const mapping = {
        categories: [
          {
            ctCategory: { id: 'cat-1' },
            taxCode: 'txcd_123'
          }
        ]
      };

      mockApiRoot._categoriesMock._mockGet.mockRejectedValue(
        new Error('API error')
      );

      await expect(validateTaxCodeMapping(mockApiRoot, mapping)).rejects.toThrow(
        'Failed to validate category mapping'
      );
    });

    it('should handle category with both id and key', async () => {
      const mapping = {
        categories: [
          {
            ctCategory: { id: 'cat-1', key: 'category-key' },
            taxCode: 'txcd_123'
          }
        ]
      };

      mockApiRoot._categoriesMock._mockGet.mockResolvedValue({
        body: { results: [{ id: 'cat-1', key: 'category-key' }] }
      });

      await validateTaxCodeMapping(mockApiRoot, mapping);

      expect(mockApiRoot._categoriesMock._mockGet).toHaveBeenCalled();
      const whereQuery = mockApiRoot._categoriesMock.get.mock.calls[0][0].queryArgs.where;
      expect(whereQuery).toContain('id="cat-1"');
      expect(whereQuery).toContain('key="category-key"');
    });
  });

  describe('createCustomTypes - edge cases', () => {
    it('should handle error when fetching existing types fails', async () => {
      mockApiRoot._typesMock._mockGet.mockRejectedValue(
        new Error('Fetch failed')
      );

      await expect(createCustomTypes(mockApiRoot)).rejects.toThrow(
        'Custom type creation or field definitions related with Stripe Tax Connector creation failed'
      );
    });

    it('should not update when all field definitions already exist', async () => {
      const existingType = {
        key: 'test-custom-type-1',
        version: 1,
        resourceTypeIds: ['product-price'],
        fieldDefinitions: [
          {
            name: 'connectorStripeTax_TaxCode',
            type: { name: 'String' }
          }
        ]
      };

      mockApiRoot._typesMock._mockGet.mockResolvedValue({
        body: { results: [existingType] }
      });

      await createCustomTypes(mockApiRoot);

      // Should not call post for updates since all fields exist
      expect(mockApiRoot._typesMock._mockWithKeyPost).not.toHaveBeenCalled();
    });

    it('should create type when it does not exist', async () => {
      mockApiRoot._typesMock._mockGet.mockResolvedValue({
        body: { results: [] }
      });
      mockApiRoot._typesMock._mockPost.mockResolvedValue({});

      await createCustomTypes(mockApiRoot);

      expect(mockApiRoot._typesMock._mockPost).toHaveBeenCalled();
    });
  });

  describe('deleteCustomTypes - edge cases', () => {
    it('should handle error when fetching types fails during deletion', async () => {
      mockApiRoot._typesMock._mockGet.mockRejectedValue(
        new Error('Fetch failed')
      );

      // Should not throw, but log error
      await deleteCustomTypes(mockApiRoot, true);

      expect(logger.error).toHaveBeenCalled();
    });

    it('should delete type when it has only one field definition', async () => {
      const existingType = {
        key: 'test-custom-type-1',
        version: 1,
        resourceTypeIds: ['product-price'],
        fieldDefinitions: [
          {
            name: 'connectorStripeTax_TaxCode'
          }
        ]
      };

      mockApiRoot._typesMock._mockGet.mockResolvedValue({
        body: { results: [existingType] }
      });
      mockApiRoot._typesMock._mockWithKeyDelete.mockResolvedValue({});

      await deleteCustomTypes(mockApiRoot, true);

      expect(mockApiRoot._typesMock._mockWithKeyDelete).toHaveBeenCalled();
    });

    it('should handle error when type deletion fails', async () => {
      const existingType = {
        key: 'test-custom-type-1',
        version: 1,
        resourceTypeIds: ['product-price'],
        fieldDefinitions: [
          {
            name: 'connectorStripeTax_TaxCode'
          }
        ]
      };

      mockApiRoot._typesMock._mockGet.mockResolvedValue({
        body: { results: [existingType] }
      });
      mockApiRoot._typesMock._mockWithKeyDelete.mockRejectedValue(
        new Error('Delete failed')
      );

      // Should not throw, but log error
      await deleteCustomTypes(mockApiRoot, true);

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('validateCustomTypes - edge cases', () => {
    it('should handle 404 error when fetching types', async () => {
      const error = new Error('Not found');
      error.statusCode = 404;
      mockApiRoot._typesMock._mockGet.mockRejectedValue(error);

      const result = await validateCustomTypes(mockApiRoot);

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should validate custom type with multiple resource types', async () => {
      const existingType = {
        key: 'test-custom-type-1',
        resourceTypeIds: ['product-price', 'line-item'],
        fieldDefinitions: [
          {
            name: 'connectorStripeTax_TaxCode'
          }
        ]
      };

      mockApiRoot._typesMock._mockGet.mockResolvedValue({
        body: { results: [existingType] }
      });

      const result = await validateCustomTypes(mockApiRoot);

      expect(result.isValid).toBe(true);
      expect(result.customTypes[0].resourceTypes).toHaveLength(2);
    });
  });
});
