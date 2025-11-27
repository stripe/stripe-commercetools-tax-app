import { expect, describe, it } from '@jest/globals';
import TaxCodeNotFoundError from '../../../src/errors/taxCodeNotFound.error.js';

describe('TaxCodeNotFoundError', () => {
  it('should create error with productId and productName', () => {
    const error = new TaxCodeNotFoundError('product-123', 'Test Product', []);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('TaxCodeNotFoundError');
    expect(error.productId).toBe('product-123');
    expect(error.productName).toBe('Test Product');
    expect(error.categories).toEqual([]);
    expect(error.statusCode).toBe(400);
  });

  it('should create error message with categories', () => {
    const categories = [
      { id: 'cat-1', name: 'Electronics', key: 'electronics' },
      { id: 'cat-2', name: 'Computers', key: 'computers' }
    ];
    const error = new TaxCodeNotFoundError('product-123', 'Laptop', categories);

    expect(error.message).toContain('Laptop');
    expect(error.message).toContain('product-123');
    expect(error.message).toContain('Electronics');
    expect(error.message).toContain('Computers');
  });

  it('should create error message without categories when empty', () => {
    const error = new TaxCodeNotFoundError('product-123', 'Test Product', []);

    expect(error.message).toContain('Test Product');
    expect(error.message).toContain('product-123');
    expect(error.message).toContain('No categories assigned');
  });

  it('should create error message when categories is null', () => {
    const error = new TaxCodeNotFoundError('product-123', 'Test Product', null);

    expect(error.message).toContain('No categories assigned');
    expect(error.categories).toEqual([]);
  });

  it('should convert to commercetools error format', () => {
    const categories = [
      { id: 'cat-1', name: 'Electronics', key: 'electronics' }
    ];
    const error = new TaxCodeNotFoundError('product-123', 'Laptop', categories);

    const commercetoolsError = error.toCommerceToolsError();

    expect(commercetoolsError).toEqual({
      code: 'InvalidInput',
      message: error.message,
      extensionExtraInfo: {
        originalError: 'TaxCodeNotFound',
        productId: 'product-123',
        productName: 'Laptop',
        categories: [
          {
            id: 'cat-1',
            name: 'Electronics',
            key: 'electronics'
          }
        ],
        action: 'Please configure a tax code mapping for one of these categories or add a custom taxCode field to the product.'
      }
    });
  });

  it('should handle categories with missing name or key', () => {
    const categories = [
      { id: 'cat-1' },
      { id: 'cat-2', name: 'Electronics' },
      { id: 'cat-3', key: 'electronics' }
    ];
    const error = new TaxCodeNotFoundError('product-123', 'Test Product', categories);

    const commercetoolsError = error.toCommerceToolsError();

    expect(commercetoolsError.extensionExtraInfo.categories).toHaveLength(3);
    expect(commercetoolsError.extensionExtraInfo.categories[0]).toEqual({
      id: 'cat-1',
      name: undefined,
      key: undefined
    });
  });

  it('should capture stack trace when available', () => {
    const error = new TaxCodeNotFoundError('product-123', 'Test Product', []);

    // Stack trace should be captured if Error.captureStackTrace is available
    if (Error.captureStackTrace) {
      expect(error.stack).toBeDefined();
    }
  });

  it('should be throwable and catchable', () => {
    expect(() => {
      throw new TaxCodeNotFoundError('product-123', 'Test Product', []);
    }).toThrow();

    try {
      throw new TaxCodeNotFoundError('product-123', 'Test Product', []);
    } catch (error) {
      expect(error).toBeInstanceOf(TaxCodeNotFoundError);
      expect(error.statusCode).toBe(400);
    }
  });
});

