# Process Ship-From Selection

## Description

The process of ship-from address selection is a hierarchical address resolution mechanism implemented in the ship-from service. This system automatically determines the appropriate ship-from address for line items by searching through multiple data sources using a fallback strategy, ensuring accurate tax calculations based on the origin location of products.

The process is designed to handle complex e-commerce scenarios where products can be shipped from multiple locations (warehouses, dropshipping suppliers, distribution centers), and the ship-from address must be accurately determined for Stripe Tax calculations. The solution uses a priority-based approach, returning the first valid address found through the strategy chain, ensuring efficient and predictable address assignment.

**Main Flow**: The system first attempts to resolve the ship-from address from the line item's supply channel (STRATEGY 1). If not available, it searches inventory entries for the product SKU (STRATEGY 2) with intelligent channel selection. Finally, if ship-from is required, it falls back to a default business address (STRATEGY 3). The system supports both required and optional ship-from modes, allowing flexibility for digital products or scenarios where ship-from is not needed.

## Problem

E-commerce platforms like commercetools handle products that can be shipped from multiple locations:
- Products can have supply channels assigned at the line item level
- Products can have multiple inventory entries with different supply channels (dropshipping scenarios)
- Some products may not have explicit supply channels and need fallback addresses
- Digital products or certain scenarios may not require ship-from addresses
- Tax calculations require accurate origin addresses for proper tax determination

The main challenges addressed by this solution include:

1. **Multiple Supply Channel Sources**: Line items can have supply channels at different levels (line item, inventory entry), requiring a priority-based resolution strategy.

2. **Dropshipping Scenarios**: Products may have multiple inventory entries with different supply channels, requiring intelligent selection of the optimal channel based on priority or stock availability.

3. **Fallback Strategy**: When no explicit supply channel is found, the system must provide a default business address or handle optional ship-from scenarios gracefully.

4. **Performance Optimization**: The system must efficiently resolve addresses for multiple line items without excessive API calls or processing time.

5. **Address Format Conversion**: Addresses from commercetools must be converted to Stripe's address format for tax calculations.

6. **Caching Strategy**: Frequently accessed channel addresses should be cached to reduce API calls and improve performance.

7. **Error Handling**: The system must handle errors gracefully, especially when ship-from is optional, without breaking the tax calculation flow.

## Solution Found

The solution implements a priority-based fallback algorithm that:

1. **Retrieves address from line item supply channel**: Uses commercetools Channel API to get the address from the line item's supply channel (STRATEGY 1 - highest priority)
2. **Searches inventory entries**: Uses commercetools Inventory API to find supply channels for the product SKU (STRATEGY 2)
3. **Selects optimal channel**: Implements intelligent channel selection using priority configuration or stock-based selection
4. **Falls back to default address**: Uses environment variables to provide a default business address when required (STRATEGY 3 - lowest priority)
5. **Handles optional mode**: Returns null when ship-from is not required (for digital products or optional scenarios)
6. **Caches addresses**: Implements in-memory caching with TTL to optimize repeated queries
7. **Formats addresses**: Converts commercetools address format to Stripe format automatically

### Key Features

- **Priority-Based Fallback**: Three-tier strategy with clear priority order (line item → inventory → default)
- **Intelligent Channel Selection**: Multiple strategies for selecting optimal channel from inventory entries (priority-based, stock-based)
- **Channel Caching**: In-memory cache system with 5-minute TTL to optimize multiple queries
- **Address Format Conversion**: Automatic conversion from commercetools to Stripe address format
- **Optional/Required Modes**: Supports both required and optional ship-from scenarios via `SHIP_FROM_REQUIRED` environment variable
- **Parallel Processing**: Resolves addresses for multiple line items in parallel for performance
- **Comprehensive Logging**: Detailed audit trail for address resolution decisions and source tracking
- **Error Resilience**: Graceful error handling that doesn't break the flow when ship-from is optional

## Solution Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│              Tax Orchestrator Service                            │
│         orchestrateTaxCalculation(cart)                          │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 3: Group Line Items by Ship-From Address                  │
│  groupLineItemsByShipFrom(cart)                                  │
│                                                                   │
│  - Resolve all ship-from addresses in parallel                   │
│  - Group line items by resolved address                          │
│  - Validate ship-from requirement (if enabled)                  │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│  resolveAllShipFromAddresses(lineItems)                        │
│  - Process all line items in parallel                            │
│  - Returns: Array<{address, source}>                            │
└───────────────────────┬─────────────────────────────────────────┘
                        │
        ┌───────────────┴───────────────┐
        │                               │
        │  For each line item:          │
        │  resolveShipFromForLineItem() │
        │                               │
        ▼                               ▼
┌───────────────────────┐   ┌───────────────────────┐
│  Line Item 1          │   │  Line Item 2          │
│  (if multiple)        │   │  (if multiple)        │
└───────────┬───────────┘   └───────────┬───────────┘
            │                           │
            ▼                           ▼
┌─────────────────────────────────────────────────────────────────┐
│         STRATEGY 1: Line Item supplyChannel                     │
│    (HIGHEST PRIORITY)                                           │
│    getAddressFromChannelId(channelId)                           │
└───────────────────────┬─────────────────────────────────────────┘
                        │
            ┌───────────┴───────────┐
            │                       │
            │ Found?                │ Not Found
            │ Yes → RETURN          │
            │                       │
            ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│         STRATEGY 2: Inventory Entry supplyChannel              │
│    (DROPSHIPPING CASE)                                          │
│    getAddressFromInventory(sku)                                 │
└───────────────────────┬─────────────────────────────────────────┘
                        │
            ┌───────────┴───────────┐
            │                       │
            │ Found?                │ Not Found
            │ Yes → RETURN          │
            │                       │
            ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│         STRATEGY 3: Default Business Address                    │
│    (LOWEST PRIORITY)                                             │
│    Only if SHIP_FROM_REQUIRED='true'                            │
│    getDefaultBusinessAddress()                                   │
└───────────────────────┬─────────────────────────────────────────┘
                        │
            ┌───────────┴───────────┐
            │                       │
            │ Required?             │ Optional
            │ Yes → RETURN          │ Return null
            │                       │
            ▼                       ▼
    ┌───────────────┐      ┌───────────────┐
    │ Return address│      │ Return null   │
    │ with source   │      │ source:       │
    │               │      │ 'not_required'│
    └───────────────┘      └───────────────┘
```

## Step-by-Step Solution Description

### Overview Flow

1. **Parallel Resolution**: The Tax Orchestrator Service calls `resolveAllShipFromAddresses()` to resolve addresses for all line items in parallel
2. **Entry Point**: For each line item, `resolveShipFromForLineItem(lineItem)` is called
3. **STRATEGY 1**: Attempts to get address from line item's supply channel using commercetools Channel API
4. **STRATEGY 2**: If STRATEGY 1 fails, searches inventory entries for the product SKU and selects optimal channel
5. **STRATEGY 3**: If STRATEGY 2 fails and ship-from is required, uses default business address from environment variables
6. **Optional Mode**: If ship-from is optional and no address is found, returns null
7. **Result**: Returns address with source information, or null if optional and not found

### Detailed Steps

#### Step 1: Parallel Address Resolution

**Method**: `ShipFromService.resolveAllShipFromAddresses(lineItems)`

**Process**:

1. **Input Validation**:
   - Receives array of line items from the cart
   - Creates promises for each line item resolution

2. **Parallel Processing**:
   - Maps each line item to `resolveShipFromForLineItem()` promise
   - Executes all resolutions in parallel using `Promise.all()`
   - Returns array of results: `Array<{address, source}>`

3. **Return**:
   - Returns array where each element corresponds to the input line item
   - Each result contains: `{address: Object|null, source: string}`

**Code Example**:
```javascript
const shipFromResults = await shipFromService.resolveAllShipFromAddresses(cart.lineItems);
// Returns: [
//   { address: {...}, source: 'lineItem.supplyChannel' },
//   { address: {...}, source: 'inventory.supplyChannel' },
//   { address: null, source: 'not_required' }
// ]
```

#### Step 2: Entry Point - Resolve Ship-From for Line Item

**Method**: `ShipFromService.resolveShipFromForLineItem(lineItem)`

**Parameters**:
- `lineItem`: commercetools cart line item object

**Process**:

1. **STRATEGY 1: Line Item supplyChannel** (Highest Priority):
   - Checks if `lineItem.supplyChannel?.id` exists
   - If yes, calls `getAddressFromChannelId(channelId)`
   - If address found:
     - Logs resolution with source: `'lineItem.supplyChannel'`
     - Returns `{ address, source: 'lineItem.supplyChannel' }`

2. **STRATEGY 2: Inventory Entry supplyChannel** (Dropshipping Case):
   - Checks if `lineItem.variant?.sku` exists
   - If yes, calls `getAddressFromInventory(sku)`
   - If address found:
     - Logs resolution with source: `'inventory.supplyChannel'`
     - Returns `{ address, source: 'inventory.supplyChannel' }`

3. **STRATEGY 3: Default Business Address** (Lowest Priority):
   - Checks if `process.env.SHIP_FROM_REQUIRED === 'true'`
   - If required:
     - Calls `getDefaultBusinessAddress()`
     - Logs resolution with source: `'default_business'`
     - Returns `{ address, source: 'default_business' }`

4. **Optional Mode**:
   - If `SHIP_FROM_REQUIRED !== 'true'`:
     - Logs that ship-from is not resolved (optional mode)
     - Returns `{ address: null, source: 'not_required' }`

5. **Error Handling**:
   - If error occurs and ship-from is optional:
     - Logs warning and returns `{ address: null, source: 'error_fallback' }`
   - If error occurs and ship-from is required:
     - Throws error to be handled by caller

#### Step 3: STRATEGY 1 - Get Address from Channel ID

**Method**: `ShipFromService.getAddressFromChannelId(channelId)`

**Process**:

1. **Cache Check**:
   - Checks in-memory cache for channel address
   - If cached and not expired (5 min TTL), returns cached address

2. **API Query**:
   - Uses commercetools Channel API:
     ```
     GET /{projectKey}/channels/{ID}
     ```
   - Fetches channel by ID

3. **Address Extraction**:
   - Checks if `channel.body?.address` exists
   - If address found:
     - Formats address using `formatAddressForStripe()`
     - Saves to cache with timestamp
     - Returns formatted address

4. **Return**:
   - Returns Stripe-formatted address or `null` if not found

**Address Format Conversion**:
```javascript
// commercetools format → Stripe format
{
  country: address.country,
  state: address.state,
  city: address.city,
  postal_code: address.postalCode || address.postal_code,
  line1: address.streetName || address.line1,
  line2: address.streetNumber || address.line2
}
```

#### Step 4: STRATEGY 2 - Get Address from Inventory

**Method**: `ShipFromService.getAddressFromInventory(sku)`

**Process**:

1. **API Query**:
   - Uses commercetools Inventory API:
     ```
     GET /{projectKey}/inventory
     where: sku="{sku}"
     expand: supplyChannel
     ```
   - Fetches all inventory entries for the SKU with expanded supply channels

2. **Filter Valid Entries**:
   - Filters entries that have:
     - Valid supply channel with address: `entry.supplyChannel?.obj?.address`
     - Available stock: `entry.availableQuantity > 0`
   - If no valid entries found, returns `null`

3. **Intelligent Channel Selection**:
   - Calls `selectOptimalChannel(entriesWithAddress)`
   - Uses multiple strategies to select the best channel

4. **Address Extraction**:
   - If optimal channel selected:
     - Formats address using `formatAddressForStripe()`
     - Logs selection reason and channel details
     - Returns formatted address

5. **Return**:
   - Returns Stripe-formatted address or `null` if no valid channel found

#### Step 5: Intelligent Channel Selection

**Method**: `ShipFromService.selectOptimalChannel(entries)`

**Process**:

1. **STRATEGY 1: Priority-Based Selection** (Highest Priority):
   - Calls `selectByPriority(entries)`
   - Uses `SHIP_FROM_CHANNEL_PRIORITY` environment variable
   - Format: comma-separated channel IDs (e.g., `"channel-1,channel-2,channel-3"`)
   - Iterates through priority list in order
   - Returns first matching entry found
   - Selection reason: `'priority_based'`

2. **STRATEGY 2: Stock-Based Selection** (Fallback):
   - If no priority match found:
     - Finds entry with highest `availableQuantity`
     - Uses `reduce()` to compare all entries
     - Returns entry with maximum stock
     - Selection reason: `'highest_stock'`

3. **Return**:
   - Returns selected entry with `selectionReason` property
   - Format: `{ ...entry, selectionReason: 'priority_based' | 'highest_stock' }`

**Priority Configuration**:
```javascript
// Environment variable: SHIP_FROM_CHANNEL_PRIORITY
// Example: "channel-warehouse-west,channel-warehouse-east,channel-dropship-1"
const prioritizedChannels = process.env.SHIP_FROM_CHANNEL_PRIORITY
  ? process.env.SHIP_FROM_CHANNEL_PRIORITY.split(',').map(id => id.trim())
  : [];
```

#### Step 6: STRATEGY 3 - Default Business Address

**Method**: `ShipFromService.getDefaultBusinessAddress()`

**Process**:

1. **Environment Variable Reading**:
   - Reads default address from environment variables:
     - `SHIP_FROM_DEFAULT_BUSINESS_COUNTRY` (default: `'US'`)
     - `SHIP_FROM_DEFAULT_BUSINESS_STATE` (default: `'NY'`)
     - `SHIP_FROM_DEFAULT_BUSINESS_CITY` (default: `'New York'`)
     - `SHIP_FROM_DEFAULT_BUSINESS_POSTAL_CODE` (default: `'10001'`)
     - `SHIP_FROM_DEFAULT_BUSINESS_LINE1` (default: `''`)
     - `SHIP_FROM_DEFAULT_BUSINESS_LINE2` (default: `''`)

2. **Address Construction**:
   - Constructs Stripe-formatted address object
   - Uses defaults if environment variables not set

3. **Return**:
   - Returns complete Stripe-formatted address object

**Example Configuration**:
```javascript
{
  country: 'US',
  state: 'NY',
  city: 'New York',
  postal_code: '10001',
  line1: '123 Main St',
  line2: 'Suite 100'
}
```

#### Step 7: Address Format Conversion

**Method**: `ShipFromService.formatAddressForStripe(address)`

**Process**:

1. **Field Mapping**:
   - Maps commercetools address fields to Stripe format:
     - `country` → `country` (direct)
     - `state` → `state` (direct)
     - `city` → `city` (direct)
     - `postalCode` or `postal_code` → `postal_code`
     - `streetName` or `line1` → `line1`
     - `streetNumber` or `line2` → `line2`

2. **Return**:
   - Returns address in Stripe format

**Conversion Rules**:
- Handles both commercetools formats (snake_case and camelCase)
- Provides fallback for field name variations
- Ensures all required Stripe fields are present

#### Step 8: Caching Strategy

**Cache Implementation**:

1. **Cache Structure**:
   - Uses `Map<channelId, {address, timestamp}>`
   - TTL: 5 minutes (300,000 milliseconds)

2. **Cache Operations**:
   - **Get**: Checks cache, validates TTL, returns cached address or null
   - **Save**: Stores address with current timestamp
   - **Clear**: Manual cache clearing via `clearCache()` method

3. **Cache Key**:
   - Uses channel ID as cache key
   - Enables fast lookup for repeated channel queries

4. **Benefits**:
   - Reduces API calls for frequently accessed channels
   - Improves performance for carts with multiple items from same channel
   - Automatic expiration prevents stale data

## Implementation Details

### Environment Variables

**Required Configuration**:

1. **SHIP_FROM_REQUIRED** (optional):
   - Values: `'true'` or any other value (default: optional mode)
   - When `'true'`: Ship-from is required, throws error if not found
   - When not `'true'`: Ship-from is optional, returns null if not found

2. **SHIP_FROM_CHANNEL_PRIORITY** (optional):
   - Format: Comma-separated channel IDs
   - Example: `"channel-1,channel-2,channel-3"`
   - Used for priority-based channel selection in STRATEGY 2

3. **Default Business Address** (optional, only if STRATEGY 3 used):
   - `SHIP_FROM_DEFAULT_BUSINESS_COUNTRY` (default: `'US'`)
   - `SHIP_FROM_DEFAULT_BUSINESS_STATE` (default: `'NY'`)
   - `SHIP_FROM_DEFAULT_BUSINESS_CITY` (default: `'New York'`)
   - `SHIP_FROM_DEFAULT_BUSINESS_POSTAL_CODE` (default: `'10001'`)
   - `SHIP_FROM_DEFAULT_BUSINESS_LINE1` (default: `''`)
   - `SHIP_FROM_DEFAULT_BUSINESS_LINE2` (default: `''`)

### Priority Order

The system follows a strict priority order:

1. **STRATEGY 1**: Line Item supplyChannel (highest priority)
   - Direct channel assignment at line item level
   - Fastest resolution path

2. **STRATEGY 2**: Inventory Entry supplyChannel
   - Dropshipping scenarios
   - Requires intelligent channel selection
   - Slower due to inventory API query

3. **STRATEGY 3**: Default Business Address (lowest priority)
   - Only used when `SHIP_FROM_REQUIRED='true'`
   - Fallback for products without supply channels

### Channel Selection Strategies

Within STRATEGY 2, channel selection follows this order:

1. **Priority-Based Selection**:
   - Uses `SHIP_FROM_CHANNEL_PRIORITY` environment variable
   - Selects first matching channel from priority list
   - Highest priority strategy

2. **Stock-Based Selection**:
   - Fallback when no priority match
   - Selects channel with highest available quantity
   - Ensures optimal stock utilization

### Error Handling

**Error Scenarios**:

1. **API Errors**:
   - Channel API errors: Returns `null`, logs warning
   - Inventory API errors: Returns `null`, logs warning
   - Non-fatal errors don't break the flow

2. **Required Mode Errors**:
   - If `SHIP_FROM_REQUIRED='true'` and no address found:
     - Throws error to be handled by caller
     - Prevents tax calculation without ship-from

3. **Optional Mode Errors**:
   - If `SHIP_FROM_REQUIRED !== 'true'` and error occurs:
     - Returns `{ address: null, source: 'error_fallback' }`
     - Logs warning but continues execution
     - Allows tax calculation to proceed without ship-from

### Source Tracking

Each resolved address includes a `source` field indicating the resolution method:

- `'lineItem.supplyChannel'`: Address from line item's supply channel
- `'inventory.supplyChannel'`: Address from inventory entry's supply channel
- `'default_business'`: Default business address from environment variables
- `'not_required'`: Ship-from is optional and not found
- `'error_fallback'`: Error occurred but ship-from is optional

## Usage Example

### Complete Flow Example

```javascript
// 1. Tax Orchestrator resolves ship-from addresses
const shipFromResults = await shipFromService.resolveAllShipFromAddresses(
  cart.lineItems
);

// 2. Group line items by ship-from address
const shipFromGroups = await taxOrchestratorService.groupLineItemsByShipFrom(cart);

// 3. For each group, create Stripe requests with ship-from
for (const group of shipFromGroups) {
  const stripeRequest = {
    line_items: [...],
    shipping_cost: {...},
    ship_from_details: {
      address: group.shipFromAddress
    }
  };
  
  // Execute Stripe tax calculation
  const calculation = await stripeClient.tax.calculations.create(stripeRequest);
}
```

### Individual Line Item Resolution

```javascript
// Resolve ship-from for a single line item
const result = await shipFromService.resolveShipFromForLineItem(lineItem);

// Result structure:
{
  address: {
    country: 'US',
    state: 'NY',
    city: 'New York',
    postal_code: '10001',
    line1: '123 Main St',
    line2: 'Suite 100'
  },
  source: 'lineItem.supplyChannel' // or 'inventory.supplyChannel', 'default_business', etc.
}
```

### Channel Priority Configuration

```javascript
// Environment variable setup
process.env.SHIP_FROM_CHANNEL_PRIORITY = "warehouse-west,warehouse-east,dropship-supplier-1";

// When multiple inventory entries exist, the system will:
// 1. First try to find warehouse-west
// 2. If not found, try warehouse-east
// 3. If not found, try dropship-supplier-1
// 4. If none found in priority list, select highest stock
```

## Technical Notes

### Performance Considerations

- **Parallel Processing**: All line items resolved simultaneously using `Promise.all()`
- **Channel Caching**: 5-minute TTL reduces API calls for repeated channels
- **Efficient Filtering**: Inventory entries filtered before channel selection
- **Early Returns**: Stops at first successful strategy (priority-based)
- **Minimal API Calls**: Only queries APIs when cache miss occurs

### Edge Cases Handled

- **Line items without supply channels**: Falls back to inventory or default
- **Products without inventory entries**: Falls back to default or returns null
- **Multiple inventory entries**: Intelligent selection based on priority or stock
- **Missing channel addresses**: Skips entries without valid addresses
- **Zero stock entries**: Filtered out before channel selection
- **API failures**: Graceful degradation with optional mode
- **Missing environment variables**: Uses sensible defaults for business address
- **Invalid address formats**: Handles both commercetools address formats

### Logging and Debugging

- **Resolution Logging**: Logs each successful resolution with source
- **Channel Selection Logging**: Logs selected channel and selection reason
- **Cache Logging**: Logs cache hits and misses for performance analysis
- **Error Logging**: Detailed error logging with context
- **Source Tracking**: Each result includes source for audit trail

### API Integration Details

**commercetools Channel API**:
```
GET /{projectKey}/channels/{ID}
```

**Response Structure**:
```javascript
{
  id: "channel-id",
  address: {
    country: "US",
    state: "NY",
    city: "New York",
    postalCode: "10001",
    streetName: "123 Main St",
    streetNumber: "Suite 100"
  }
}
```

**commercetools Inventory API**:
```
GET /{projectKey}/inventory
where: sku="{sku}"
expand: supplyChannel
```

**Response Structure**:
```javascript
{
  results: [
    {
      sku: "product-sku",
      availableQuantity: 100,
      supplyChannel: {
        id: "channel-id",
        obj: {
          id: "channel-id",
          address: {...}
        }
      }
    }
  ]
}
```

## Configuration Requirements

### commercetools Setup

1. **Channel Configuration**:
   - Create channels in commercetools with addresses
   - Assign channels to line items via `supplyChannel` reference
   - Ensure channels have complete address information

2. **Inventory Configuration**:
   - Create inventory entries with `supplyChannel` references
   - Ensure supply channels have addresses
   - Maintain accurate stock quantities for optimal selection

3. **Line Item Configuration**:
   - Assign `supplyChannel` to line items when available
   - Ensure SKU is present in `variant.sku` for inventory lookup

### Environment Variables

**Required** (for STRATEGY 3):
- `SHIP_FROM_REQUIRED`: Set to `'true'` if ship-from is mandatory

**Optional**:
- `SHIP_FROM_CHANNEL_PRIORITY`: Comma-separated channel IDs for priority-based selection
- `SHIP_FROM_DEFAULT_BUSINESS_COUNTRY`: Default country (default: `'US'`)
- `SHIP_FROM_DEFAULT_BUSINESS_STATE`: Default state (default: `'NY'`)
- `SHIP_FROM_DEFAULT_BUSINESS_CITY`: Default city (default: `'New York'`)
- `SHIP_FROM_DEFAULT_BUSINESS_POSTAL_CODE`: Default postal code (default: `'10001'`)
- `SHIP_FROM_DEFAULT_BUSINESS_LINE1`: Default street address line 1
- `SHIP_FROM_DEFAULT_BUSINESS_LINE2`: Default street address line 2

## Related Documentation

- `ship-from-tax-calculation-flow.md`: Complete tax calculation flow with ship-from integration
- `ship-from-detection-flow.md`: Detailed ship-from detection and grouping logic
- `process-category-taxcode-selection.md`: Tax code selection process documentation

## Summary

The process of ship-from address selection is a robust system that:

1. **Resolves addresses** using three-tier priority strategy (line item → inventory → default)
2. **Applies STRATEGY 1** as the primary method, using line item supply channels
3. **Falls back to STRATEGY 2** for dropshipping scenarios with intelligent channel selection
4. **Uses STRATEGY 3** as final fallback when ship-from is required
5. **Supports optional mode** for digital products or scenarios where ship-from is not needed
6. **Optimizes performance** with caching and parallel processing
7. **Provides clear source tracking** for audit and debugging purposes

This system ensures efficient, predictable, and maintainable ship-from address resolution for accurate tax calculations in complex e-commerce platforms with multiple fulfillment locations.

