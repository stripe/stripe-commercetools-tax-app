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

**Optional:** If not provided, the system will skip country-based behavior determination and proceed to merchant default.

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


## Priority Order

The tax behavior is determined using the following priority order:

1. **Country Mapping** - If `COUNTRY_TAX_BEHAVIOR_MAPPING` is configured and the shipping country matches a country in the mapping, that behavior is used
2. **Merchant Default** - Falls back to `TAX_BEHAVIOR_DEFAULT` value (if configured)
3. **Stripe Automatic** - If no behavior is determined, Stripe will use automatic behavior based on currency


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

### Full Configuration
```bash
# Default behavior for all calculations
TAX_BEHAVIOR_DEFAULT=exclusive

# Country-specific overrides (optional)
COUNTRY_TAX_BEHAVIOR_MAPPING='{"US":"exclusive","CA":"exclusive","DE":"inclusive","FR":"inclusive","GB":"inclusive","AU":"inclusive","IT":"inclusive","ES":"inclusive","NL":"inclusive"}'
```

This configuration will:
- Use `exclusive` tax behavior for US and Canadian customers (from country mapping)
- Use `inclusive` tax behavior for European and Australian customers (from country mapping)
- Fall back to `exclusive` for any other countries (from merchant default)
- If no behavior is determined, let Stripe use automatic behavior based on currency

### Minimal Configuration
```bash
# Only merchant default
TAX_BEHAVIOR_DEFAULT=exclusive
```

This configuration will:
- Use `exclusive` tax behavior for all customers (from merchant default)
- If no behavior is determined, let Stripe use automatic behavior based on currency

### No Configuration
```bash
# No tax behavior environment variables set
```

This configuration will:
- Let Stripe use automatic behavior based on currency for all customers
