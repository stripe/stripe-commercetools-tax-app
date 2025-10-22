# Tax Behavior Configuration

This document explains how to configure tax behavior for the Stripe Tax Calculator connector.

## Environment Variables

### TAX_BEHAVIOR_DEFAULT
Sets the default tax behavior for all tax calculations when no other rules apply.

**Valid values:**
- `inclusive` - Tax is included in the displayed price
- `exclusive` - Tax is added on top of the displayed price  
- `automatic` - Stripe determines behavior based on currency

**Example:**
```bash
TAX_BEHAVIOR_DEFAULT=exclusive
```

### COUNTRY_TAX_BEHAVIOR_MAPPING
JSON object mapping country codes to their default tax behavior. This allows different tax behaviors for different markets.

**Format:**
```json
{
  "US": "exclusive",
  "CA": "exclusive", 
  "DE": "inclusive",
  "FR": "inclusive",
  "GB": "inclusive",
  "AU": "inclusive"
}
```

**Example:**
```bash
COUNTRY_TAX_BEHAVIOR_MAPPING='{"US":"exclusive","DE":"inclusive","FR":"inclusive","GB":"inclusive","AU":"inclusive"}'
```

### TAX_BEHAVIOR_CUSTOM_FIELD_NAME
Configurable name for the custom field that contains tax behavior overrides on products and variants.

**Default:** `connectorTaxStripe_TaxBehavior`

**Example:**
```bash
TAX_BEHAVIOR_CUSTOM_FIELD_NAME=taxBehavior
```

If not specified, the service will use the default field name `connectorTaxStripe_TaxBehavior`.

## Priority Order

The tax behavior is determined using the following priority order:

1. **Product Custom Field Override** - If a product or variant has the configured custom field (default: `connectorTaxStripe_TaxBehavior`), that value is used
2. **Country Mapping** - If the shipping country matches a country in `COUNTRY_TAX_BEHAVIOR_MAPPING`, that behavior is used
3. **Merchant Default** - Falls back to `TAX_BEHAVIOR_DEFAULT` value
4. **Stripe Automatic** - If no behavior is determined, Stripe will use automatic behavior based on currency

## Product Custom Fields

To override tax behavior for specific products, add a custom field to your commercetools product or variant:

**Custom Field Key:** Configured via `TAX_BEHAVIOR_CUSTOM_FIELD_NAME` (default: `connectorTaxStripe_TaxBehavior`)
**Valid Values:** `inclusive`, `exclusive`, `automatic`

**Example:**
```json
{
  "custom": {
    "fields": {
      "connectorTaxStripe_TaxBehavior": "inclusive"
    }
  }
}
```

**Note:** The custom field name is configurable via the `TAX_BEHAVIOR_CUSTOM_FIELD_NAME` environment variable. If this variable is not set, the service will use the default field name `connectorTaxStripe_TaxBehavior`.

## Regional Recommendations

### North America (US, CA)
- **Recommended:** `exclusive`
- **Reason:** Standard practice in North America to show prices without tax

### European Union (DE, FR, IT, ES, etc.)
- **Recommended:** `inclusive` 
- **Reason:** EU regulations often require inclusive pricing for B2C transactions

### United Kingdom
- **Recommended:** `inclusive`
- **Reason:** Standard practice in UK retail

### Australia
- **Recommended:** `inclusive`
- **Reason:** GST is typically included in displayed prices

## Example Configuration

```bash
# Default behavior for all calculations
TAX_BEHAVIOR_DEFAULT=exclusive

# Country-specific overrides
COUNTRY_TAX_BEHAVIOR_MAPPING='{"US":"exclusive","CA":"exclusive","DE":"inclusive","FR":"inclusive","GB":"inclusive","AU":"inclusive","IT":"inclusive","ES":"inclusive","NL":"inclusive"}'

# Custom field name for product overrides (optional - defaults to connectorTaxStripe_TaxBehavior)
TAX_BEHAVIOR_CUSTOM_FIELD_NAME=taxBehavior
```

This configuration will:
- Use `exclusive` tax behavior for US and Canadian customers
- Use `inclusive` tax behavior for European and Australian customers  
- Fall back to `exclusive` for any other countries
- Allow product-specific overrides via the configured custom field (default: `connectorTaxStripe_TaxBehavior`)
- If no behavior is determined, let Stripe use automatic behavior based on currency
