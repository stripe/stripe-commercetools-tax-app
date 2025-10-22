/**
 * Custom Type Definitions for Stripe Tax Connector
 *
 * This file contains all custom type definitions required for the Stripe Tax connector.
 * Custom types are created during post-deploy to enable merchants to configure
 * tax codes at different levels (products, categories, shipping methods).
 */

export const TAX_CODE_CUSTOM_TYPE_NAME = 'connectorStripeTax_TaxCode';

/**
 * Custom type for Product and Line Item tax code configuration
 * Allows merchants to set tax codes directly on products or line items
 */
export const PRODUCT_TAX_CUSTOM_TYPE = {
  key: 'connector-stripe-tax-product',
  name: {
    en: 'Stripe Tax Connector Configuration',
  },
  description: {
    en: 'Custom fields for Stripe Tax connector to configure tax codes and settings per product',
  },
  resourceTypeIds: ['product-price', 'line-item'],
  fieldDefinitions: [
    {
      name: TAX_CODE_CUSTOM_TYPE_NAME,
      label: {
        en: 'Stripe Tax Code',
      },
      required: false,
      type: {
        name: 'String',
      },
      inputHint: 'SingleLine',
    },
  ],
};

/**
 * Custom type for Category tax code configuration
 * Allows merchants to set tax codes directly on categories for automatic inheritance
 */
export const CATEGORY_TAX_CUSTOM_TYPE = {
  key: 'connector-stripe-tax-category',
  name: {
    en: 'Stripe Tax Category Configuration',
  },
  description: {
    en: 'Custom fields for Stripe Tax connector to configure tax codes per category',
  },
  resourceTypeIds: ['category'],
  fieldDefinitions: [
    {
      name: TAX_CODE_CUSTOM_TYPE_NAME,
      label: {
        en: 'Stripe Tax Code',
      },
      required: false,
      type: {
        name: 'String',
      },
      inputHint: 'SingleLine',
    },
  ],
};

/**
 * Custom type for Shipping Method tax code configuration
 * Allows merchants to set tax codes for shipping methods
 */
export const SHIPPING_TAX_CUSTOM_TYPE = {
  key: 'connector-stripe-tax-shipping',
  name: {
    en: 'Stripe Tax Shipping Configuration',
  },
  description: {
    en: 'Custom fields for Stripe Tax connector shipping method configuration',
  },
  resourceTypeIds: ['shipping-method'],
  fieldDefinitions: [
    {
      name: TAX_CODE_CUSTOM_TYPE_NAME,
      label: {
        en: 'Stripe Tax Code',
      },
      required: false,
      type: {
        name: 'String',
      },
      inputHint: 'SingleLine',
    },
  ],
};
