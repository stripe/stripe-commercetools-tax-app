// tax-calculator/test/unit/tax-code.service.spec.js
import { expect, describe, it, jest, beforeEach } from '@jest/globals';
import taxCodeService from '../../src/services/tax-code.service.js';
import TaxCodeNotFoundError from '../../src/errors/taxCodeNotFound.error.js';
import { TAX_CODE_CUSTOM_TYPE_NAME } from '../../src/connectors/customTypes.js';

describe('TaxCodeService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getTaxCodeForProduct', () => {
    it('should return tax code from line item custom field', () => {
      const cartLineItem = {
        id: 'line-item-1',
        productId: 'product-1',
        custom: {
          fields: {
            [TAX_CODE_CUSTOM_TYPE_NAME]: 'txcd_12345678'
          }
        }
      };

      const result = taxCodeService.getTaxCodeForProduct(cartLineItem);
      expect(result).toBe('txcd_12345678');
    });

    it('should return tax code from variant custom field', () => {
      const cartLineItem = {
        id: 'line-item-1',
        productId: 'product-1',
        variant: {
          custom: {
            fields: {
              [TAX_CODE_CUSTOM_TYPE_NAME]: 'txcd_87654321'
            }
          }
        }
      };

      const result = taxCodeService.getTaxCodeForProduct(cartLineItem);
      expect(result).toBe('txcd_87654321');
    });

    it('should return tax code from category custom field', () => {
      const cartLineItem = {
        id: 'line-item-1',
        productId: 'product-1',
        categories: [
          {
            id: 'category-1',
            custom: {
              fields: {
                [TAX_CODE_CUSTOM_TYPE_NAME]: 'txcd_11111111'
              }
            }
          }
        ]
      };

      const result = taxCodeService.getTaxCodeForProduct(cartLineItem);
      expect(result).toBe('txcd_11111111');
    });

    it('should throw TaxCodeNotFoundError when no tax code found', () => {
      const cartLineItem = {
        id: 'line-item-1',
        productId: 'product-1',
        categories: [
          {
            id: 'category-1',
            name: 'Electronics'
            // No custom field
          }
        ]
      };

      expect(() => {
        taxCodeService.getTaxCodeForProduct(cartLineItem);
      }).toThrow(TaxCodeNotFoundError);
    });
  });

  describe('getShippingTaxCodeFromShippingInfo', () => {
    it('should return tax code from shipping method custom field', () => {
      const shippingInfo = {
        shippingMethod: {
          id: 'shipping-method-1',
          obj: {
            custom: {
              fields: {
                [TAX_CODE_CUSTOM_TYPE_NAME]: 'txcd_shipping_01'
              }
            }
          }
        }
      };

      const result = taxCodeService.getShippingTaxCodeFromShippingInfo(shippingInfo, 'Single');
      expect(result).toBe('txcd_shipping_01');
    });

    it('should throw TaxCodeShippingNotFoundError when no tax code found', () => {
      const shippingInfo = {
        shippingMethod: {
          id: 'shipping-method-1',
          obj: {
            name: 'Standard Shipping'
            // No custom field
          }
        }
      };

      expect(() => {
        taxCodeService.getShippingTaxCodeFromShippingInfo(shippingInfo, 'Single');
      }).toThrow('No tax code mapping found for shipping method "Standard Shipping" (shipping-method-1). Please configure a tax code for this shipping method.');
    });
  });
});