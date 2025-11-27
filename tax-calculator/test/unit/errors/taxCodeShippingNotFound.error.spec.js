import { expect, describe, it } from '@jest/globals';
import TaxCodeShippingNotFoundError from '../../../src/errors/taxCodeShippingNotFound.error.js';
import { TAX_CODE_CUSTOM_TYPE_NAME } from '../../../src/connectors/customTypes.js';

describe('TaxCodeShippingNotFoundError', () => {
  describe('constructor', () => {
    it('should create error for Single shipping mode', () => {
      const shippingMethodObj = {
        name: 'Standard Shipping'
      };

      const error = new TaxCodeShippingNotFoundError(
        'shipping-1',
        'shipping-type-1',
        shippingMethodObj,
        'Single'
      );

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('TaxCodeShippingNotFoundError');
      expect(error.shippingMethodId).toBe('shipping-1');
      expect(error.shippingMethodTypeId).toBe('shipping-type-1');
      expect(error.shippingMethodObj).toBe(shippingMethodObj);
      expect(error.shippingMode).toBe('Single');
      expect(error.statusCode).toBe(400);
      expect(error.message).toContain('No tax code mapping found for shipping method "Standard Shipping"');
      expect(error.message).toContain('shipping-1');
    });

    it('should create error for Single mode with unknown shipping method', () => {
      const error = new TaxCodeShippingNotFoundError(
        'shipping-1',
        'shipping-type-1',
        {},
        'Single'
      );

      expect(error.message).toContain('No tax code mapping found for shipping method "Unknown Shipping Method"');
    });

    it('should create error for Multiple shipping mode', () => {
      const error = new TaxCodeShippingNotFoundError(
        null,
        null,
        [],
        'Multiple'
      );

      expect(error.shippingMethodId).toBeNull();
      expect(error.shippingMethodTypeId).toBeNull();
      expect(error.shippingMethodObj).toEqual([]);
      expect(error.shippingMode).toBe('Multiple');
      expect(error.message).toContain('No tax code mapping found for any of the multiple shipping methods');
    });

    it('should default to Single mode when not specified', () => {
      const error = new TaxCodeShippingNotFoundError(
        'shipping-1',
        'shipping-type-1',
        { name: 'Standard Shipping' }
      );

      expect(error.shippingMode).toBe('Single');
    });
  });

  describe('toCommerceToolsError', () => {
    it('should convert Single mode error to commercetools format', () => {
      const shippingMethodObj = {
        name: 'Standard Shipping'
      };

      const error = new TaxCodeShippingNotFoundError(
        'shipping-1',
        'shipping-type-1',
        shippingMethodObj,
        'Single'
      );

      const commercetoolsError = error.toCommerceToolsError();

      expect(commercetoolsError).toEqual({
        code: 'InvalidInput',
        message: error.message,
        extensionExtraInfo: {
          originalError: 'TaxCodeShippingNotFound',
          shippingMode: 'Single',
          shippingMethodId: 'shipping-1',
          shippingMethodName: 'Standard Shipping',
          shippingMethodTypeId: 'shipping-type-1',
          action: `Please configure a tax code for this shipping method by adding a custom field "${TAX_CODE_CUSTOM_TYPE_NAME}" to the shipping method.`
        }
      });
    });

    it('should convert Multiple mode error to commercetools format', () => {
      const shippingArray = [
        {
          shippingKey: 'shipping-1',
          shippingInfo: {
            shippingMethod: {
              id: 'method-1',
              obj: {
                name: 'Method 1',
                custom: {
                  fields: {
                    [TAX_CODE_CUSTOM_TYPE_NAME]: null
                  }
                }
              }
            }
          }
        },
        {
          shippingKey: 'shipping-2',
          shippingInfo: {
            shippingMethod: {
              id: 'method-2',
              obj: {
                name: 'Method 2',
                custom: {
                  fields: {}
                }
              }
            }
          }
        }
      ];

      const error = new TaxCodeShippingNotFoundError(
        null,
        null,
        shippingArray,
        'Multiple'
      );

      const commercetoolsError = error.toCommerceToolsError();

      expect(commercetoolsError.code).toBe('InvalidInput');
      expect(commercetoolsError.extensionExtraInfo.shippingMode).toBe('Multiple');
      expect(commercetoolsError.extensionExtraInfo.affectedShippingMethods).toBeDefined();
      expect(commercetoolsError.extensionExtraInfo.action).toContain('at least one shipping method');
    });

    it('should handle Single mode with missing shipping method name', () => {
      const error = new TaxCodeShippingNotFoundError(
        'shipping-1',
        'shipping-type-1',
        {},
        'Single'
      );

      const commercetoolsError = error.toCommerceToolsError();

      expect(commercetoolsError.extensionExtraInfo.shippingMethodName).toBe('Unknown Shipping Method');
    });
  });

  describe('getActionMessage', () => {
    it('should return action message for Single mode', () => {
      const error = new TaxCodeShippingNotFoundError(
        'shipping-1',
        'shipping-type-1',
        { name: 'Standard Shipping' },
        'Single'
      );

      const actionMessage = error.getActionMessage();

      expect(actionMessage).toContain('this shipping method');
      expect(actionMessage).toContain(TAX_CODE_CUSTOM_TYPE_NAME);
    });

    it('should return action message for Multiple mode', () => {
      const error = new TaxCodeShippingNotFoundError(
        null,
        null,
        [],
        'Multiple'
      );

      const actionMessage = error.getActionMessage();

      expect(actionMessage).toContain('at least one shipping method');
      expect(actionMessage).toContain(TAX_CODE_CUSTOM_TYPE_NAME);
    });
  });

  describe('getAffectedShippingMethods', () => {
    it('should return empty array for Single mode', () => {
      const error = new TaxCodeShippingNotFoundError(
        'shipping-1',
        'shipping-type-1',
        { name: 'Standard Shipping' },
        'Single'
      );

      const affected = error.getAffectedShippingMethods();

      expect(affected).toEqual([]);
    });

    it('should return affected shipping methods for Multiple mode with array', () => {
      const shippingArray = [
        {
          shippingKey: 'shipping-1',
          shippingInfo: {
            shippingMethod: {
              id: 'method-1',
              obj: {
                name: 'Method 1',
                custom: {
                  fields: {
                    [TAX_CODE_CUSTOM_TYPE_NAME]: 'txcd_123'
                  }
                }
              }
            }
          }
        },
        {
          shippingKey: 'shipping-2',
          shippingInfo: {
            shippingMethod: {
              id: 'method-2',
              obj: {
                name: 'Method 2',
                custom: {
                  fields: {}
                }
              }
            }
          }
        }
      ];

      const error = new TaxCodeShippingNotFoundError(
        null,
        null,
        shippingArray,
        'Multiple'
      );

      const affected = error.getAffectedShippingMethods();

      expect(affected).toHaveLength(2);
      expect(affected[0]).toEqual({
        shippingKey: 'shipping-1',
        shippingMethodId: 'method-1',
        shippingMethodName: 'Method 1',
        hasTaxCode: true
      });
      expect(affected[1]).toEqual({
        shippingKey: 'shipping-2',
        shippingMethodId: 'method-2',
        shippingMethodName: 'Method 2',
        hasTaxCode: false
      });
    });

    it('should return empty array for Multiple mode with non-array shippingMethodObj', () => {
      const error = new TaxCodeShippingNotFoundError(
        null,
        null,
        { notAnArray: true },
        'Multiple'
      );

      const affected = error.getAffectedShippingMethods();

      expect(affected).toEqual([]);
    });

    it('should handle missing shippingInfo in Multiple mode', () => {
      const shippingArray = [
        {
          shippingKey: 'shipping-1',
          shippingInfo: null
        }
      ];

      const error = new TaxCodeShippingNotFoundError(
        null,
        null,
        shippingArray,
        'Multiple'
      );

      const affected = error.getAffectedShippingMethods();

      expect(affected).toHaveLength(1);
      expect(affected[0].shippingMethodId).toBeUndefined();
    });

    it('should handle missing obj in shippingMethod', () => {
      const shippingArray = [
        {
          shippingKey: 'shipping-1',
          shippingInfo: {
            shippingMethod: {
              id: 'method-1'
            }
          }
        }
      ];

      const error = new TaxCodeShippingNotFoundError(
        null,
        null,
        shippingArray,
        'Multiple'
      );

      const affected = error.getAffectedShippingMethods();

      expect(affected).toHaveLength(1);
      expect(affected[0].shippingMethodName).toBeUndefined();
    });
  });
});

