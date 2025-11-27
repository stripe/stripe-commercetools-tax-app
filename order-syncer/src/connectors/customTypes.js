/**
 * Custom Type Definitions for Stripe Tax Connector
 *
 * This file contains all custom type definitions required for the Stripe Tax connector.
 * Custom types are created during post-deploy to enable merchants to configure
 * tax codes at different levels (products, categories, shipping methods).
 */

export const ORDER_TAX_FIELD_NAMES = {
  CALCULATION_REFERENCES: 'connectorStripeTax_calculationReferences',
  TRANSACTION_REFERENCES: 'connectorStripeTax_transactionReferences'
};

export const ORDER_TAX_CUSTOM_TYPE = {
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
      "name": ORDER_TAX_FIELD_NAMES.TRANSACTION_REFERENCES,
      "label": {
        "en": "Stripe Tax Transaction References"
      },
      "type": {
        "name": "Set",
        "elementType": {
          "name": "String"
        }
      },
      "required": false,
      "inputHint": "SingleLine"
    }
  ]
}
