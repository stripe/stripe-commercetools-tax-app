# Process Tax Behavior Determination

## Description

The process of tax behavior determination is a priority-based configuration mechanism implemented in the tax behavior service. This system automatically determines whether taxes should be calculated as inclusive or exclusive for cart line items based on country-specific mappings and merchant-wide default configurations.

The process is designed to handle e-commerce scenarios where different countries or regions require different tax calculation behaviors. The solution uses a priority-based fallback logic: first checking country-specific mappings, then falling back to merchant-wide defaults, and finally allowing Stripe to use its own default behavior if no configuration is found.

**Main Flow**: The system determines tax behavior **per destination** — the country the goods are delivered to — and applies it to the line items of that destination's Stripe request. The determination follows a priority order: (1) country-based behavior from configuration mapping, keyed on the destination, (2) merchant-wide default configuration, and (3) null (letting Stripe use its default behavior).

> **Amended 2026-09-17 (SB3-218).** This document previously described the behavior as resolved
> "once at the cart level" from `cart.country`. That was the defect, not a simplification:
> `cart.country` selects catalog prices and is shopper-controlled, so keying the behavior on it
> let a shopper force `inclusive` on a price published as exclusive — under which Stripe keeps the
> customer's total constant and the merchant remits the tax from their own margin. Resolution is
> now keyed on the delivery destination, and a cart delivering to several countries resolves one
> behavior per destination. Where sections below still say "cart-level", read "per destination".
> See `../decisions/adr-007-tax-destination-country.md`.

## Problem

E-commerce platforms require flexible tax behavior configuration for different markets:

- Different countries have different tax calculation requirements (inclusive vs exclusive)
- Some regions require taxes to be included in product prices (inclusive)
- Other regions require taxes to be added on top of product prices (exclusive)
- Merchants need a way to configure tax behavior at both country and global levels
- The system must handle cases where no configuration is provided (let Stripe decide)

The main challenges addressed by this solution include:

1. **Country-Specific Configuration**: Different countries require different tax behaviors, and the system must support country-level configuration.

2. **Merchant-Wide Defaults**: Merchants need a fallback configuration that applies when no country-specific rule exists.

3. **Stripe Default Behavior**: When no configuration is provided, the system should allow Stripe to use its own default behavior rather than forcing a value.

4. **Per-Destination Application**: Tax behavior is determined once per delivery destination and applied to the line items of that destination's request. A cart delivering to one place resolves it once; a cart delivering to several resolves one per place.

5. **Configuration Caching**: Configuration is read from environment variables and parsed JSON, requiring efficient caching to avoid repeated I/O and parsing operations.

6. **Validation**: Tax behavior values must be validated against allowed Stripe tax behavior values.

## Solution Found

The solution implements a priority-based determination algorithm that:

1. **Determines per-destination behavior**: Calculates tax behavior for the country an order is delivered to
2. **Applies to that destination's line items**: Uses the same behavior for every line item in the same Stripe request
3. **Priority-based lookup**: Checks country mapping first, then merchant default, then returns null
4. **Validates behavior values**: Ensures only valid Stripe tax behavior values are used
5. **Caches configuration**: Uses in-memory caching to avoid repeated I/O and JSON parsing
6. **Returns null gracefully**: Returns null when no configuration is found, allowing Stripe to use its default

### Key Features

- **Priority-Based Fallback**: Country mapping → Merchant default → null (Stripe default)
- **Per-Destination Determination**: Tax behavior determined from the delivery country, applied to that destination's line items and its shipping line
- **Configuration Caching**: 5-minute TTL cache for configuration and parsed JSON mappings
- **Value Validation**: Validates tax behavior values against Stripe's allowed values
- **Graceful Degradation**: Returns null when no configuration found, letting Stripe decide
- **Comprehensive Logging**: Detailed audit trail for tax behavior decisions and sources

## Solution Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│              Tax Orchestrator Service                            │
│         orchestrateTaxCalculation(cart)                          │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 1: Determine Tax Behavior for a Destination              │
│  determineTaxBehaviorForCart(cart, destinationCountry)          │
│                                                                   │
│  - Destination = the delivery address country                   │
│  - Resolve behavior for that destination                        │
│  - Apply to that destination's line items                       │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 2: Determine Cart Tax Behavior                           │
│  determineCartTaxBehavior(cart, destinationCountry)             │
│                                                                   │
│  Priority Order:                                                 │
│  1. Country-based behavior (country mapping)                    │
│  2. Merchant-wide default configuration                          │
│  3. null (let Stripe use default)                               │
└───────────────────────┬─────────────────────────────────────────┘
                        │
            ┌───────────┴───────────┐
            │                       │
            │ Priority 1            │ Not Found
            │ Country Mapping?      │ Try Priority 2
            │                       │
            ▼                       ▼
┌───────────────────────┐   ┌───────────────────────┐
│ getCountryBasedBehavior│   │ getMerchantDefault    │
│ (destinationCountry)   │   │ Behavior()            │
│                        │   │                       │
│ - Get country code     │   │ - Read config         │
│ - Look up in mapping   │   │ - Get taxBehaviorDefault│
│ - Validate behavior    │   │ - Validate behavior   │
│ - Return if found     │   │ - Return if found     │
└───────────┬───────────┘   └───────────┬───────────┘
            │                           │
            │ Found?                    │ Found?
            │ Yes → RETURN              │ Yes → RETURN
            │                           │
            └───────────┬───────────────┘
                        │
                        │ Not Found
                        ▼
                ┌───────────────┐
                │ Return null   │
                │ (Stripe default)│
                └───────────────┘
```

## Step-by-Step Solution Description

### Overview Flow

1. **Entry Point**: Tax Orchestrator resolves the destination via `resolveDestinationCountry(cart, shipping)` and calls `determineTaxBehaviorForCart(cartRequest, destinationCountry)`
2. **Per-Destination Determination**: `determineCartTaxBehavior(cart, destinationCountry)` determines the behavior for one destination's request
3. **Priority Lookup**: Checks country mapping first, then merchant default, then returns null
4. **Application**: Applies the same behavior to all line items in the cart
5. **Return**: Returns a map of `{lineItemId: taxBehavior}` where all line items have the same behavior

### Detailed Steps

#### Step 1: Entry Point - Determine Tax Behavior for Cart

**Method**: `TaxBehaviorService.determineTaxBehaviorForCart(cartRequest)`

**Parameters**:
- `cartRequest`: commercetools cart request object

**Process**:

1. **Per-Destination Determination**:
   - Calls `determineCartTaxBehavior(cartRequest, destinationCountry)` to resolve the behavior for this request's delivery destination
   - This ensures all line items in the cart have the same tax behavior

2. **Application to Line Items**:
   - Creates a map `lineItemBehaviors = {}`
   - Iterates through all line items in `cartRequest.lineItems`
   - Assigns that destination's behavior to each line item in the request: `lineItemBehaviors[lineItem.id] = cartTaxBehavior`

3. **Return**:
   - Returns map: `{lineItemId: taxBehavior}` where all values are the same

**Code Example**:
```javascript
const taxBehaviors = taxBehaviorService.determineTaxBehaviorForCart(cart);
// Result: { "line-item-1": "inclusive", "line-item-2": "inclusive", ... }
// All line items have the same behavior
```

#### Step 2: Determine Cart Tax Behavior

**Method**: `TaxBehaviorService.determineCartTaxBehavior(cartContext, destinationCountry)`

**Parameters**:
- `cartContext`: Cart object, used for the merchant-default and logging paths
- `destinationCountry`: the delivery country for this request — the only country that selects a behavior

**Process**:

1. **Priority 1: Country-Based Behavior**:
   - Calls `getCountryBasedBehavior(destinationCountry)`
   - If found and valid, returns the country-specific behavior immediately
   - Logs: `"Using country-based tax behavior for country {country}: {behavior}"`

2. **Priority 2: Merchant-Wide Default**:
   - If country-based behavior not found, calls `getMerchantDefaultBehavior()`
   - If found and valid, returns the merchant default behavior
   - Logs: `"Using merchant default tax behavior: {behavior}"`

3. **Priority 3: Stripe Default**:
   - If neither country mapping nor merchant default is found, returns `null`
   - Logs: `"No tax behavior determined for cart, letting Stripe use its default behavior"`
   - Stripe will use its own default behavior for tax calculations

4. **Return**:
   - Returns tax behavior string (`"inclusive"` or `"exclusive"`) or `null`

**Priority Order**:
```
1. Country mapping (highest priority)
2. Merchant default (fallback)
3. null (Stripe default, lowest priority)
```

#### Step 3: Get Country-Based Behavior

**Method**: `TaxBehaviorService.getCountryBasedBehavior(countryCode)`

**Process**:

1. **Country Code**:
   - Takes the destination country code directly, rather than a cart to read a country off.
     The signature is deliberate: a caller has to be explicit about *which* country it means,
     and that ambiguity — "the country", without saying which of the cart's two — is what
     produced SB3-218.
   - Returns `null` if the country code is missing. With no destination there is no
     destination-based rule, so resolution falls through to the merchant default and then to the
     account's own Stripe Tax setting.

2. **Country Mapping Lookup**:
   - Calls `getCountryTaxBehaviorMapping()` to get the country-to-behavior mapping
   - Looks up behavior for country code (uppercase): `countryMapping[countryCode.toUpperCase()]`

3. **Validation**:
   - Validates behavior using `isValidBehavior(behavior)`
   - Checks if behavior is in `VALID_TAX_BEHAVIORS` array

4. **Return**:
   - Returns lowercase behavior string if found and valid
   - Returns `null` if not found or invalid
   - Logs warning if error occurs during lookup

**Configuration Format**:
```javascript
// Environment variable: TAX_BEHAVIOR_COUNTRY_MAPPING
// JSON format:
{
  "US": "exclusive",
  "GB": "inclusive",
  "AU": "exclusive",
  "CA": "inclusive"
}
```

#### Step 4: Get Merchant Default Behavior

**Method**: `TaxBehaviorService.getMerchantDefaultBehavior()`

**Process**:

1. **Configuration Retrieval**:
   - Calls `getCachedConfiguration()` to get configuration object
   - Reads `config.taxBehaviorDefault` from configuration

2. **Validation**:
   - Validates behavior using `isValidBehavior(merchantBehavior)`
   - Checks if behavior is in `VALID_TAX_BEHAVIORS` array

3. **Return**:
   - Returns lowercase behavior string if found and valid
   - Returns `null` if not found or invalid
   - Logs warning if error occurs during configuration read

**Configuration Format**:
```javascript
// Environment variable or config file
// Format: string value
taxBehaviorDefault: "inclusive" // or "exclusive"
```

#### Step 5: Get Country Tax Behavior Mapping

**Method**: `TaxBehaviorService.getCountryTaxBehaviorMapping()`

**Process**:

1. **Cache Check**:
   - Checks if `countryMappingCache` exists and is not expired (5-minute TTL)
   - Returns cached mapping if valid

2. **Configuration Read**:
   - Calls `getCachedConfiguration()` to get configuration
   - Reads `config.countryTaxBehaviorMapping` (JSON string)

3. **JSON Parsing**:
   - Parses JSON string: `JSON.parse(countryMappingJson)`
   - Caches parsed result for future use

4. **Error Handling**:
   - Returns empty object `{}` if parsing fails
   - Logs warning if error occurs

5. **Return**:
   - Returns parsed mapping object: `{ "US": "exclusive", ... }`
   - Returns empty object if not configured or parsing fails

#### Step 6: Get Cached Configuration

**Method**: `TaxBehaviorService.getCachedConfiguration()` (private)

**Process**:

1. **Cache Validation**:
   - Checks if `configCache` exists and is not expired (5-minute TTL)
   - Returns cached configuration if valid

2. **Configuration Read**:
   - Calls `configUtils.readConfiguration()` to read configuration from file/environment
   - Caches configuration object with current timestamp

3. **Return**:
   - Returns configuration object
   - Configuration is cached for 5 minutes to avoid repeated I/O

**Cache Strategy**:
- TTL: 5 minutes
- Stores: Configuration object and timestamp
- Benefits: Reduces I/O operations and JSON parsing

#### Step 7: Validate Tax Behavior

**Method**: `TaxBehaviorService.isValidBehavior(behavior)`

**Process**:

1. **Validation Check**:
   - Checks if behavior (lowercase) is in `VALID_TAX_BEHAVIORS` array
   - Valid values: `["inclusive", "exclusive"]`

2. **Return**:
   - Returns `true` if behavior is valid
   - Returns `false` if behavior is null, undefined, or not in valid list

**Valid Tax Behaviors**:
```javascript
VALID_TAX_BEHAVIORS = ["inclusive", "exclusive"]
```

## Implementation Details

### Tax Behavior Values

**Valid Values**:
- `"inclusive"`: Taxes are included in the product price (e.g., prices shown include tax)
- `"exclusive"`: Taxes are added on top of the product price (e.g., prices shown exclude tax)

**Stripe Behavior**:
- When `tax_behavior` is set to `"inclusive"`, Stripe calculates tax assuming the amount already includes tax
- When `tax_behavior` is set to `"exclusive"`, Stripe calculates tax to be added to the amount
- When `tax_behavior` is `null` or not provided, Stripe uses its own default behavior

### Priority-Based Fallback Logic

**Priority Order**:
1. **Country Mapping** (highest priority): Country-specific tax behavior from configuration
2. **Merchant Default** (fallback): Merchant-wide default tax behavior
3. **Stripe Default** (lowest priority): Returns `null`, letting Stripe decide

**Decision Flow**:
```
Country Mapping → Found? → Yes → Return behavior
                ↓ No
Merchant Default → Found? → Yes → Return behavior
                ↓ No
Return null (Stripe default)
```

### Per-Destination Application

**Design Decision**: Tax behavior is determined once per **destination** and applied to the line items of that destination's Stripe request.

**Rationale**:
- Tax behavior is a property of the jurisdiction the goods are delivered to, so it has to be resolved where that is known
- A Single-mode cart has one destination, so this reduces to one resolution and one code path — the common case is unchanged
- A Multiple-mode cart may deliver to several countries. Resolving once per cart meant a shipment to Berlin and a shipment to New York shared one behavior; now each gets its own, and so does its shipping line (`business-rules/tax-calculation.md` Rule 6)
- `tax-orchestrator.service.js` recomputes only when a shipping method's destination differs from the cart's, so nothing extra happens for an ordinary single-destination cart

**Implementation**:
```javascript
// Determine once
const cartTaxBehavior = determineCartTaxBehavior(cart);

// Apply to all line items
const lineItemBehaviors = {};
for (const lineItem of cart.lineItems) {
  lineItemBehaviors[lineItem.id] = cartTaxBehavior;
}
```

### Configuration Caching Strategy

**In-Memory Cache**:
- TTL: 5 minutes
- Stores: Configuration object, parsed country mapping, timestamps
- Benefits: Reduces I/O operations and JSON parsing overhead

**Cache Keys**:
- Configuration cache: Single cache entry (no key needed)
- Country mapping cache: Single cache entry (no key needed)

**Cache Invalidation**:
- Automatic: After 5 minutes TTL
- Manual: Via `clearCache()` method (useful for testing)

**Cache Structure**:
```javascript
{
  configCache: { /* configuration object */ },
  configCacheTimestamp: 1234567890,
  countryMappingCache: { "US": "exclusive", ... }
}
```

### Configuration Sources

**Configuration Utility**:
- Uses `configUtils.readConfiguration()` to read configuration
- Supports environment variables and configuration files
- Returns configuration object with properties:
  - `taxBehaviorDefault`: Merchant-wide default tax behavior
  - `countryTaxBehaviorMapping`: JSON string of country-to-behavior mapping

**Environment Variables**:
- `TAX_BEHAVIOR_DEFAULT`: Merchant-wide default (e.g., `"inclusive"` or `"exclusive"`)
- `TAX_BEHAVIOR_COUNTRY_MAPPING`: JSON string (e.g., `'{"US":"exclusive","GB":"inclusive"}'`)

## Usage Example

### Complete Flow Example

```javascript
// 1. Tax Orchestrator determines tax behavior
const taxBehaviors = taxBehaviorService.determineTaxBehaviorForCart(cart);

// 2. Result structure
// {
//   "line-item-1": "inclusive",
//   "line-item-2": "inclusive",
//   "line-item-3": "inclusive"
// }
// All line items have the same behavior

// 3. Use in Stripe request
for (const lineItem of cart.lineItems) {
  const taxBehavior = taxBehaviors[lineItem.id];
  
  lineItemData.tax_behavior = taxBehavior; // "inclusive", "exclusive", or null
  taxRequest.line_items.push(lineItemData);
}
```

### Country Mapping Example

```javascript
// Configuration: TAX_BEHAVIOR_COUNTRY_MAPPING
{
  "US": "exclusive",  // US uses exclusive tax
  "GB": "inclusive", // UK uses inclusive tax
  "AU": "exclusive", // Australia uses exclusive tax
  "CA": "inclusive"  // Canada uses inclusive tax
}

// Cart with country "US"
const cart = { country: "US", lineItems: [...] };
const behaviors = taxBehaviorService.determineTaxBehaviorForCart(cart);
// Result: { "line-item-1": "exclusive", "line-item-2": "exclusive", ... }
```

### Merchant Default Example

```javascript
// Configuration: TAX_BEHAVIOR_DEFAULT = "inclusive"
// No country mapping configured

// Cart with country "FR" (not in mapping)
const cart = { country: "FR", lineItems: [...] };
const behaviors = taxBehaviorService.determineTaxBehaviorForCart(cart);
// Result: { "line-item-1": "inclusive", "line-item-2": "inclusive", ... }
// Uses merchant default
```

### Stripe Default Example

```javascript
// No configuration at all (no country mapping, no merchant default)

// Cart with country "DE"
const cart = { country: "DE", lineItems: [...] };
const behaviors = taxBehaviorService.determineTaxBehaviorForCart(cart);
// Result: { "line-item-1": null, "line-item-2": null, ... }
// Returns null, letting Stripe use its default behavior
```

## Technical Notes

### Performance Considerations

- **Configuration Caching**: 5-minute TTL cache reduces I/O and JSON parsing overhead
- **Per-Destination Determination**: Determines behavior once per delivery destination rather than per line item — one resolution for an ordinary single-destination cart
- **Early Returns**: Returns immediately when country mapping is found (no need to check merchant default)
- **Efficient Lookup**: Country mapping uses direct object property access (O(1))
- **Validation Optimization**: Validates behavior values against constant array (O(1))

### Edge Cases Handled

- **Missing Country**: Returns null if country code is missing (falls back to merchant default or Stripe default)
- **Invalid Behavior Values**: Validates behavior values and ignores invalid ones
- **JSON Parse Errors**: Handles JSON parsing errors gracefully, returns empty object
- **Configuration Read Errors**: Logs warnings and continues with fallback logic
- **Cache Expiration**: Automatically invalidates cache after 5 minutes
- **Empty Configuration**: Returns null when no configuration is provided (lets Stripe decide)
- **Case Insensitivity**: Converts country codes to uppercase and behaviors to lowercase

### Logging and Debugging

- **Decision Logging**: Logs which priority level was used (country mapping, merchant default, or Stripe default)
- **Configuration Warnings**: Logs warnings when configuration read or parsing fails
- **Behavior Assignment**: Logs tax behavior assignment with product ID, variant ID, and decision reason
- **Cache Operations**: Logs cache hits and misses for performance analysis
- **Audit Trail**: Maintains timestamp and decision reason for each tax behavior determination

### API Integration Details

**Stripe Tax Calculations API**:
```
POST /v1/tax/calculations
```

**Request Structure with Tax Behavior**:
```javascript
{
  currency: 'usd',
  line_items: [
    {
      amount: 1000,
      reference: 'line-item-1',
      tax_code: 'txcd_12345678',
      tax_behavior: 'inclusive' // or 'exclusive' or null
    }
  ],
  // ...
}
```

**Tax Behavior Impact**:
- `"inclusive"`: Stripe assumes the amount already includes tax and calculates the tax portion
- `"exclusive"`: Stripe calculates tax to be added to the amount
- `null` or omitted: Stripe uses its own default behavior based on jurisdiction

## Configuration Requirements

### Environment Variables

1. **TAX_BEHAVIOR_DEFAULT** (optional):
   - Merchant-wide default tax behavior
   - Values: `"inclusive"` or `"exclusive"`
   - Example: `TAX_BEHAVIOR_DEFAULT=inclusive`
   - Used when no country-specific mapping is found

2. **TAX_BEHAVIOR_COUNTRY_MAPPING** (optional):
   - JSON string mapping country codes to tax behaviors
   - Format: `'{"US":"exclusive","GB":"inclusive","AU":"exclusive"}'`
   - Example: `TAX_BEHAVIOR_COUNTRY_MAPPING='{"US":"exclusive","GB":"inclusive"}'`
   - Used as highest priority (checked first)

### Configuration File (Alternative)

If using configuration files instead of environment variables:

```javascript
// config.json or similar
{
  "taxBehaviorDefault": "inclusive",
  "countryTaxBehaviorMapping": "{\"US\":\"exclusive\",\"GB\":\"inclusive\"}"
}
```

### Valid Tax Behavior Values

**Allowed Values**:
- `"inclusive"`: Taxes included in price
- `"exclusive"`: Taxes added to price

**Invalid Values**:
- Any value not in `VALID_TAX_BEHAVIORS` array
- `null` or `undefined` (treated as "no configuration", not an error)

## Related Documentation

- `process-tax-orchestration.md`: Complete tax calculation flow that uses tax behavior service
- `process-update-action-creation.md`: Update action creation that includes tax behavior in calculations
- Tax behavior constants: `tax-calculator/src/constants/tax-behavior.constants.js`
- Configuration utility: `tax-calculator/src/utils/config.util.js`

## Summary

The process of tax behavior determination is a robust priority-based system that:

1. **Determines tax behavior once per delivery destination** and applies it to that destination's line items and shipping line
2. **Uses priority-based fallback logic**: Country mapping → Merchant default → Stripe default
3. **Validates behavior values** against Stripe's allowed values
4. **Caches configuration** to optimize performance and reduce I/O operations
5. **Returns null gracefully** when no configuration is found, allowing Stripe to use its default
6. **Provides comprehensive logging** for audit trails and debugging
7. **Handles edge cases** including missing configuration, invalid values, and parsing errors

This system ensures flexible, efficient, and maintainable tax behavior configuration for e-commerce platforms. The priority-based approach provides country-specific customization while maintaining merchant-wide defaults and graceful degradation to Stripe's default behavior when no configuration is provided.

