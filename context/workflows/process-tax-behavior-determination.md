# Process Tax Behavior Determination

**Trigger:** step 4 of `process-tax-orchestration.md` — `determineTaxBehaviorForCart(cart, destinationCountry)`
once for the cart's destination (`tax-calculator/src/services/tax-orchestrator.service.js:42-44`), and again in
Multiple mode for each shipping entry whose destination differs from the cart's
(`tax-calculator/src/services/tax-orchestrator.service.js:315-318`).
**Modules involved:** tax-calculator — `tax-behavior.service.js`, `utils/config.util.js`,
`constants/tax-behavior.constants.js`. Rules: `business-rules/tax-behavior.md` Rules 1–5,
`business-rules/tax-calculation.md` Rule 6, *Shipping tax behavior follows the same resolved behavior as line items*, `business-rules/tax-destination.md` Rule 4, *Tax behavior is resolved from the same destination the provider is told*.
**Outcome:** `{ lineItemId: 'inclusive' | 'exclusive' | null }`, one value for every line item of the cart. It
is copied onto each request line item and onto that request's shipping cost; `null` means the field is
omitted.

## Happy Path

1. The destination is the country of the address Stripe will be sent — `tax-calculator/src/services/tax-orchestrator.service.js:572-574`
2. Country mapping: `TAX_BEHAVIOR_COUNTRY_MAPPING[destination.toUpperCase()]`, if it is a valid value —
   `tax-calculator/src/services/tax-behavior.service.js:81-98`, `:122-143`
3. Else `TAX_BEHAVIOR_DEFAULT`, if valid — `tax-calculator/src/services/tax-behavior.service.js:57-62`, `:103-117`
4. Else `null` — `tax-calculator/src/services/tax-behavior.service.js:64-66`
5. The same value is assigned to every line item of the cart — `tax-calculator/src/services/tax-behavior.service.js:33-36`
6. It is set on request line items and shipping cost only when non-null —
   `tax-calculator/src/services/tax-orchestrator.service.js:265-269`, `:285-288`, `:422-425`, `:466-469`

## Error Paths

| Condition | Behavior | File |
| --- | --- | --- |
| Mapping JSON unparsable, or an array | Rejected by `readConfiguration()`; behavior is `null`, and the cart update fails elsewhere | `tax-calculator/src/validators/env-var.validators.js:63-67`; `tax-calculator/src/validators/helpers.validators.js:156-171`; `tax-calculator/src/utils/config.util.js:27-33`; `tax-calculator/src/services/tax-behavior.service.js:138-142` |
| A mapping value is not `inclusive` / `exclusive` | Ignored → next priority | `tax-calculator/src/services/tax-behavior.service.js:90-92` |
| `TAX_BEHAVIOR_DEFAULT` set but not `inclusive` / `exclusive` (in any case) | Rejected by `readConfiguration()`; the country mapping is lost too, behavior is `null`, and the cart update fails elsewhere | `tax-calculator/src/validators/env-var.validators.js:57-61`; `tax-calculator/src/utils/config.util.js:27-33`; `tax-calculator/src/services/tax-behavior.service.js:138-142` |
| Configuration invalid — `readConfiguration()` throws | Behavior `null` here (warning); the same configuration then fails the cart update elsewhere (category query, Stripe client) | `tax-calculator/src/services/tax-behavior.service.js:93-95`, `:111-113`, `:157`; `tax-calculator/src/utils/config.util.js:27-33` |

## Notes

- **On a default deploy the `null` path is not reached.** `connect.yaml` ships `TAX_BEHAVIOR_DEFAULT='exclusive'`
  and a nine-country mapping (`connect.yaml:26-31`).
- **A cart with no delivery address is keyed on `cart.country`**, because that is then the destination
  (`tax-calculator/src/services/tax-orchestrator.service.js:552`). "No destination" in this
  document means neither exists.
- **Mapping keys must be written in upper case.** Only the looked-up code is upper-cased; a `"de"` key never
  matches (`tax-calculator/src/services/tax-behavior.service.js:88`).
- **Stripe's account default behavior never reaches the running service.** Post-deploy copies it into
  `process.env.TAX_BEHAVIOR_DEFAULT` inside the post-deploy process only
  (`tax-calculator/src/validators/stripeTaxValidator.js:72-77`).

---

## Description

The process of tax behavior determination is a priority-based configuration mechanism implemented in the tax behavior service. This system automatically determines whether taxes should be calculated as inclusive or exclusive for cart line items based on country-specific mappings and merchant-wide default configurations.

The process is designed to handle e-commerce scenarios where different countries or regions require different tax calculation behaviors. The solution uses a priority-based fallback logic: first checking country-specific mappings, then falling back to merchant-wide defaults, and finally allowing Stripe to use its own default behavior if no configuration is found.

**Main Flow**: The system determines tax behavior **per destination** — the country the goods are delivered to — and applies it to the line items of that destination's Stripe request. The determination follows a priority order: (1) country-based behavior from configuration mapping, keyed on the destination, (2) merchant-wide default configuration, and (3) null (letting Stripe use its default behavior).

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

**Method**: `TaxBehaviorService.determineTaxBehaviorForCart(cartRequest, destinationCountry)`

**Parameters**:
- `cartRequest`: commercetools cart request object
- `destinationCountry`: the delivery country (default `null`)

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

#### Step 2: Determine Cart Tax Behavior

**Method**: `TaxBehaviorService.determineCartTaxBehavior(cartContext, destinationCountry)`

**Parameters**:
- `cartContext`: Cart object, used for the merchant-default and logging paths
- `destinationCountry`: the delivery country for this request — the only country that selects a behavior

**Process**:

1. **Priority 1: Country-Based Behavior**:
   - Calls `getCountryBasedBehavior(destinationCountry)`
   - If found and valid, returns the country-specific behavior immediately
   - Logs (debug): `"Using country-based tax behavior for destination {destinationCountry}: {behavior}"`
     (`tax-calculator/src/services/tax-behavior.service.js:53`)

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
   - Returns empty object `{}` if reading the configuration throws; an unparsable mapping is one cause,
     because `readConfiguration()` rejects it before `JSON.parse` here sees it
     (`tax-calculator/src/validators/env-var.validators.js:63-67`, `tax-calculator/src/services/tax-behavior.service.js:129`)
   - Logs warning if error occurs

5. **Return**:
   - Returns parsed mapping object: `{ "US": "exclusive", ... }`
   - Returns empty object if not configured or the configuration cannot be read

#### Step 6: Get Cached Configuration

**Method**: `TaxBehaviorService.getCachedConfiguration()` (private)

**Process**:

1. **Cache Validation**:
   - Checks if `configCache` exists and is not expired (5-minute TTL)
   - Returns cached configuration if valid

2. **Configuration Read**:
   - Calls `configUtils.readConfiguration()` to read configuration from environment variables only;
     it reads `process.env` and validates it, and throws when any variable — commercetools credentials
     included — is invalid (`tax-calculator/src/utils/config.util.js:12-36`)
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
- The connector never sends `null` — it omits the field
  (`tax-calculator/src/services/tax-orchestrator.service.js:266-269`) — and the default that then applies is
  the account's own Stripe Tax setting, per the service's own note
  (`tax-calculator/src/services/tax-behavior.service.js:73-76`)

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
- A Multiple-mode cart may deliver to several countries; each destination resolves its own behavior, and so does its shipping line (`business-rules/tax-calculation.md` Rule 6, *Shipping tax behavior follows the same resolved behavior as line items*)
- `tax-orchestrator.service.js` recomputes only when a shipping method's destination differs from the cart's, so nothing extra happens for an ordinary single-destination cart

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
- Supports environment variables only (`tax-calculator/src/utils/config.util.js:12-23`)
- Returns configuration object with properties:
  - `taxBehaviorDefault`: Merchant-wide default tax behavior
  - `countryTaxBehaviorMapping`: JSON string of country-to-behavior mapping

**Environment Variables**:
- `TAX_BEHAVIOR_DEFAULT`: Merchant-wide default (e.g., `"inclusive"` or `"exclusive"`)
- `TAX_BEHAVIOR_COUNTRY_MAPPING`: JSON string (e.g., `'{"US":"exclusive","GB":"inclusive"}'`)

## Technical Notes

### Performance Considerations

- **Configuration Caching**: 5-minute TTL cache reduces I/O and JSON parsing overhead
- **Per-Destination Determination**: Determines behavior once per delivery destination rather than per line item — one resolution for an ordinary single-destination cart
- **Early Returns**: Returns immediately when country mapping is found (no need to check merchant default)
- **Efficient Lookup**: Country mapping uses direct object property access (O(1))
- **Validation Optimization**: Validates behavior values against constant array (O(1))

### Edge Cases Handled

- **Missing Country**: Returns null if country code is missing (falls back to merchant default or Stripe default)
- **Invalid Behavior Values**: An invalid value inside the country mapping is ignored; an invalid
  `TAX_BEHAVIOR_DEFAULT` is not — it invalidates the whole configuration (see Error Paths)
- **JSON Parse Errors**: An unparsable mapping is rejected by `readConfiguration()`, which invalidates the
  whole configuration (see Error Paths); it is not a local parse error
- **Configuration Read Errors**: Logs warnings and continues with fallback logic
- **Cache Expiration**: Automatically invalidates cache after 5 minutes
- **Empty Configuration**: Returns null when no configuration is provided (lets Stripe decide)
- **Case Insensitivity**: Converts country codes to uppercase and behaviors to lowercase

### Logging and Debugging

- **Decision Logging**: Logs which priority level was used (country mapping, merchant default, or Stripe default)
- **Configuration Warnings**: Logs warnings when configuration read or parsing fails
- **Behavior Assignment**: Logs tax behavior assignment with product ID, variant ID, and decision reason
  (once per cart, for the first line item, at debug level — `tax-calculator/src/services/tax-orchestrator.service.js:53-55`)
- **Cache Operations**: not logged
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
- `null` or omitted: Stripe uses its own default behavior — the account's Stripe Tax setting, which on
  "Automatic" is currency-based (per `tax-calculator/src/services/tax-behavior.service.js:73-76`). The
  connector omits the field rather than sending `null`.

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

### Valid Tax Behavior Values

**Allowed Values**:
- `"inclusive"`: Taxes included in price
- `"exclusive"`: Taxes added to price

**Invalid Values**:
- Any value not in `VALID_TAX_BEHAVIORS` array
- `null` or `undefined` (treated as "no configuration", not an error)

## Related Documentation

- `process-tax-orchestration.md`: Complete tax calculation flow that uses tax behavior service
- `process-update-action-creation.md`: Update action creation from the resulting calculations (it does not
  read the tax behavior)
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
