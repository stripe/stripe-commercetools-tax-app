/**
 * Custom error thrown when no tax code can be determined for a product
 * This should result in a commercetools validation error (400) response
 */
class TaxCodeNotFoundError extends Error {
  constructor(productId, productName, categories) {
    const categoryNames = (categories || [])
      .map(cat => cat.name || cat.key || 'unknown')
      .join(', ');

    const message = categoryNames
      ? `No tax code mapping found for product "${productName}" (${productId}). Categories: ${categoryNames}`
      : `No tax code mapping found for product "${productName}" (${productId}). No categories assigned.`;

    super(message);

    this.name = 'TaxCodeNotFoundError';
    this.productId = productId;
    this.productName = productName;
    this.categories = categories || [];
    this.statusCode = 400; // Bad Request - validation error

    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TaxCodeNotFoundError);
    }
  }

  /**
   * Convert error to commercetools API Extension error format
   * @returns {Object} Error object in commercetools format
   */
  toCommerceToolsError() {
    return {
      code: 'InvalidInput',
      message: this.message,
      extensionExtraInfo: {
        originalError: 'TaxCodeNotFound',
        productId: this.productId,
        productName: this.productName,
        categories: this.categories.map(cat => ({
          id: cat.id,
          name: cat.name,
          key: cat.key
        })),
        action: 'Please configure a tax code mapping for one of these categories or add a custom taxCode field to the product.'
      }
    };
  }
}

export default TaxCodeNotFoundError;
