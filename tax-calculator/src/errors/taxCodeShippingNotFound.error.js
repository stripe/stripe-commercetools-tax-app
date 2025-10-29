import { TAX_CODE_CUSTOM_TYPE_NAME } from "../connectors/customTypes.js";

/**
 * Custom error thrown when no tax code can be determined for a shipping method
 * This should result in a commercetools validation error (400) response
 */
class TaxCodeShippingNotFoundError extends Error {
  constructor(shippingMethodId, shippingMethodTypeId, shippingMethodObj, shippingMode = 'Single') {
    const shippingMethodName = shippingMethodObj?.name || 'Unknown Shipping Method';
    const shippingModeText = shippingMode === 'Multiple' ? 'multiple shipping methods' : 'shipping method';
    
    const message = shippingMode === 'Multiple' 
      ? `No tax code mapping found for any of the ${shippingModeText}. Please configure a tax code for at least one shipping method.`
      : `No tax code mapping found for ${shippingModeText} "${shippingMethodName}" (${shippingMethodId}). Please configure a tax code for this shipping method.`;

    super(message);

    this.name = 'TaxCodeShippingNotFoundError';
    this.shippingMethodId = shippingMethodId;
    this.shippingMethodTypeId = shippingMethodTypeId;
    this.shippingMethodObj = shippingMethodObj;
    this.shippingMode = shippingMode;
    this.statusCode = 400; // Bad Request - validation error

    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TaxCodeShippingNotFoundError);
    }
  }

/**
 * Convert error to commercetools API Extension error format
 * @returns {Object} Error object in commercetools format
 */
toCommerceToolsError() {
  const baseError = {
    code: 'InvalidInput',
    message: this.message,
    extensionExtraInfo: {
      originalError: 'TaxCodeShippingNotFound',
      shippingMode: this.shippingMode,
      action: this.getActionMessage()
    }
  };

  // Add specific information based on shipping mode
  if (this.shippingMode === 'Single') {
    baseError.extensionExtraInfo.shippingMethodId = this.shippingMethodId;
    baseError.extensionExtraInfo.shippingMethodName = this.shippingMethodObj?.name;
    baseError.extensionExtraInfo.shippingMethodTypeId = this.shippingMethodTypeId;
  } else {
    baseError.extensionExtraInfo.affectedShippingMethods = this.getAffectedShippingMethods();
  }

  return baseError;
}

  /**
 * Get action message based on shipping mode
 * @returns {string} Action message
 */
  getActionMessage() {
    if (this.shippingMode === 'Single') {
      return `Please configure a tax code for this shipping method by adding a custom field "${TAX_CODE_CUSTOM_TYPE_NAME}" to the shipping method.`;
    } else {
      return `Please configure a tax code for at least one shipping method by adding a custom field "${TAX_CODE_CUSTOM_TYPE_NAME}" to the shipping methods.`;
    }
  }

  /**
   * Get affected shipping methods for Multiple mode
   * @returns {Array} Array of affected shipping methods
   */
  getAffectedShippingMethods() {
    if (this.shippingMode === 'Multiple' && this.shippingMethodObj) {
      return Array.isArray(this.shippingMethodObj) 
        ? this.shippingMethodObj.map(shipping => ({
            shippingKey: shipping.shippingKey,
            shippingMethodId: shipping.shippingInfo?.shippingMethod?.id,
            shippingMethodName: shipping.shippingInfo?.shippingMethod?.obj?.name,
            hasTaxCode: !!shipping.shippingInfo?.shippingMethod?.obj?.custom?.fields?.[TAX_CODE_CUSTOM_TYPE_NAME]
          }))
        : [];
    }
    return [];
  }
}

export default TaxCodeShippingNotFoundError;