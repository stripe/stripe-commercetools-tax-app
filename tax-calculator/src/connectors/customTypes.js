/**
 * Custom Type Definitions for Stripe Tax Connector
 *
 * This file contains all custom type definitions required for the Stripe Tax connector.
 * Custom types are created during post-deploy to enable merchants to configure
 * tax codes at different levels (products, categories, shipping methods).
 */

export const TAX_CODE_CUSTOM_TYPE_NAME = 'connectorStripeTax_TaxCode';

export const CART_TAX_FIELD_NAMES = {
  CALCULATION_REFERENCE: 'connectorStripeTax_calculationReference',
  AMOUNT_TOTAL: 'connectorStripeTax_amountTotal',
  TAX_AMOUNT_EXCLUSIVE: 'connectorStripeTax_taxAmountExclusive',
  TAX_AMOUNT_INCLUSIVE: 'connectorStripeTax_taxAmountInclusive',
  CURRENCY: 'connectorStripeTax_currency',
  EXPIRES_AT: 'connectorStripeTax_expiresAt',
  CALCULATION_TIMESTAMP: 'connectorStripeTax_calculationTimestamp'
};

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

export const CART_TAX_CUSTOM_TYPE = {
  "key": "connector-stripe-tax-calculation-reference",
  "name": {
    "en": "Stripe Tax Calculation Reference"
  },
  "description": {
    "en": "Stripe tax calculation reference for cart and order"
  },
  "resourceTypeIds": ["order"],
  "fieldDefinitions": [
    {
      "name": CART_TAX_FIELD_NAMES.CALCULATION_REFERENCE,
      "label": {
        "en": "Stripe Tax Calculation Reference"
      },
      "type": {
        "name": "String"
      },
      "required": false,
      "inputHint": "SingleLine"
    },
    {
      "name": CART_TAX_FIELD_NAMES.AMOUNT_TOTAL,
      "label": {
        "en": "Total Amount (cents)"
      },
      "type": {
        "name": "Number"
      },
      "required": false,
      "inputHint": "SingleLine"
    },
    {
      "name": CART_TAX_FIELD_NAMES.TAX_AMOUNT_EXCLUSIVE,
      "label": {
        "en": "Tax Amount Exclusive (cents)"
      },
      "type": {
        "name": "Number"
      },
      "required": false,
      "inputHint": "SingleLine"
    },
    {
      "name": CART_TAX_FIELD_NAMES.TAX_AMOUNT_INCLUSIVE,
      "label": {
        "en": "Tax Amount Inclusive (cents)"
      },
      "type": {
        "name": "Number"
      },
      "required": false,
      "inputHint": "SingleLine"
    },
    {
      "name": CART_TAX_FIELD_NAMES.CURRENCY,
      "label": {
        "en": "Currency Code"
      },
      "type": {
        "name": "String"
      },
      "required": false,
      "inputHint": "SingleLine"
    },
    {
      "name": CART_TAX_FIELD_NAMES.EXPIRES_AT,
      "label": {
        "en": "Tax Calculation Expires At"
      },
      "type": {
        "name": "DateTime"
      },
      "required": false,
      "inputHint": "SingleLine"
    },
    {
      "name": CART_TAX_FIELD_NAMES.CALCULATION_TIMESTAMP,
      "label": {
        "en": "Calculation Timestamp"
      },
      "type": {
        "name": "DateTime"
      },
      "required": false,
      "inputHint": "SingleLine"
    }
  ]
}