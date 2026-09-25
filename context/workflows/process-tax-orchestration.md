# Process Tax Orchestration

## Description

The process of tax orchestration is the main coordination mechanism implemented in the tax-orchestrator service. This system orchestrates the complete tax calculation flow by integrating multiple specialized services to determine tax behavior, retrieve product categories, resolve ship-from addresses, create Stripe tax calculation requests, execute calculations in parallel, and transform results into commercetools update actions.

The process is designed to handle complex e-commerce scenarios where products may be shipped from multiple locations, shipping methods may vary, and tax calculations must be precise and traceable. The solution coordinates all sub-processes in a sequential flow, ensuring data consistency and optimal performance through parallel processing where possible.

**Main Flow**: The system receives a commercetools cart object, determines tax behavior for the cart, retrieves product categories from commercetools API, groups line items by ship-from address, creates separate Stripe requests (by shipping key in Multiple mode), executes all calculations in parallel, and transforms the results into commercetools update actions. The orchestration ensures that all specialized services work together seamlessly to produce accurate tax calculations.

## Problem

E-commerce platforms require complex tax calculation orchestration that involves multiple data sources and services:
- Tax behavior must be determined at the cart level and applied consistently
- Product categories must be retrieved to determine tax codes
- Ship-from addresses must be resolved for accurate origin-based tax calculations
- Multiple shipping methods require separate tax calculations for precision
- Line items may be split across shipping methods in Multiple mode
- Multiple Stripe calculations must be executed efficiently
- Results must be transformed into commercetools-compatible update actions

The main challenges addressed by this solution include:

1. **Service Coordination**: Multiple specialized services must be coordinated in the correct sequence with proper data flow between them.

2. **Ship-From Grouping**: Line items must be grouped by ship-from address to ensure accurate origin-based tax calculations.

3. **Multiple Shipping Mode Complexity**: In Multiple mode, line items are split across shipping methods, requiring proportional amount calculations and separate requests per shipping method.

4. **Parallel Execution**: Multiple Stripe calculations must be executed in parallel for performance while handling failures gracefully.

5. **Request Creation**: Stripe requests must be created with correct tax codes, ship-from addresses, customer addresses, and shipping costs.

6. **Result Transformation**: Multiple calculation results must be transformed into commercetools update actions with proper shipping key mapping.

7. **Error Handling**: Failures at any step must be handled gracefully without breaking the entire flow.

## Solution Found

The solution implements a sequential orchestration algorithm that:

1. **Determines tax behavior**: Uses tax behavior service to determine cart-level tax behavior (inclusive/exclusive)
2. **Retrieves categories**: Uses category service to fetch product categories from commercetools API with caching
3. **Groups by ship-from**: Uses ship-from service to resolve addresses and groups line items by ship-from address
4. **Creates requests**: Builds Stripe requests separated by shipping key (Multiple mode) or single request (Single mode)
5. **Executes calculations**: Runs all Stripe calculations in parallel using Promise.allSettled
6. **Creates update actions**: Uses update action service to transform calculations into commercetools update actions

### Key Features

- **Sequential Service Coordination**: Orchestrates all services in the correct order with proper data dependencies
- **Ship-From Grouping**: Groups line items by ship-from address for accurate origin-based calculations
- **Shipping Key Separation**: Creates separate requests per shipping method in Multiple mode for precision
- **Proportional Amount Calculation**: Calculates proportional line item amounts when split across shipping methods
- **Parallel Execution**: Executes all Stripe calculations in parallel for optimal performance
- **Graceful Failure Handling**: Uses Promise.allSettled to continue with successful calculations even if some fail
- **Comprehensive Logging**: Detailed logging at each orchestration step for audit and debugging
- **Update Action Transformation**: Transforms multiple calculation results into commercetools update actions

## Solution Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│              API Extension / Controller                          │
│         Receives commercetools cart                               │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│         orchestrateTaxCalculation(cart)                           │
│         Tax Orchestrator Service Entry Point                     │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 1: Determine Tax Behavior                                  │
│  taxBehaviorService.determineTaxBehaviorForCart(cart)            │
│  - Determines cart-level tax behavior (inclusive/exclusive)     │
│  - Applied to all line items                                     │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 2: Get Categories for Products                            │
│  categoryService.getCategoriesForProducts(productIds)           │
│  - Fetches categories from commercetools API                    │
│  - Uses caching (5 min TTL)                                     │
│  - Returns: Map<productId, Array<Category>>                     │
│  See: process-category-taxcode-selection.md                     │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 3: Group Line Items by Ship-From Address                  │
│  groupLineItemsByShipFrom(cart)                                  │
│                                                                   │
│  - Resolves ship-from addresses in parallel                     │
│  - Groups line items by address key                             │
│  - Validates ship-from requirement (if enabled)                 │
│  See: process-ship-from-selection.md                            │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 4: Create Stripe Requests                                 │
│  createRequestsForGroup(group, cart, ...)                        │
│                                                                   │
│  ┌───────────────────────┐   ┌───────────────────────┐          │
│  │ Single Mode           │   │ Multiple Mode         │          │
│  │ - One request         │   │ - One request per     │          │
│  │ - All line items      │   │   shipping method     │          │
│  │ - Single shipping     │   │ - Proportional amounts│          │
│  └───────────┬───────────┘   └───────────┬───────────┘          │
│              │                           │                       │
│              └───────────┬───────────────┘                       │
│                          │                                       │
│                          ▼                                       │
│  For each group:                                                 │
│  - Get tax codes (process-category-taxcode-selection.md)        │
│  - Get shipping tax codes (process-shipping-taxcode-selection.md)│
│  - Build Stripe request with ship-from, customer address        │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 5: Execute Tax Calculations in Parallel                  │
│  executeTaxCalculations(requests, stripeClient)                 │
│                                                                   │
│  - Executes all requests in parallel                            │
│  - Uses Promise.allSettled for graceful failure handling       │
│  - Returns successful calculations only                         │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 6: Create Update Actions                                  │
│  updateActionService.createCartUpdateActionsFromMultipleCalculations()│
│                                                                   │
│  - Combines calculations for metadata                           │
│  - Creates line item tax actions                                │
│  - Creates shipping tax actions                                 │
│  See: process-update-action-creation.md                        │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
                ┌───────────────┐
                │ Return Update │
                │ Actions Array │
                └───────────────┘
```

## Step-by-Step Solution Description

### Overview Flow

1. **Determine Tax Behavior**: Determines cart-level tax behavior (inclusive/exclusive) using tax behavior service
2. **Get Categories**: Retrieves product categories from commercetools API using category service with caching
3. **Group by Ship-From**: Resolves ship-from addresses and groups line items by address using ship-from service
4. **Create Requests**: Builds Stripe tax calculation requests, separated by shipping key in Multiple mode
5. **Execute Calculations**: Executes all Stripe calculations in parallel using Promise.allSettled
6. **Create Update Actions**: Transforms calculation results into commercetools update actions using update action service
7. **Return Actions**: Returns array of update actions for commercetools API Extension

### Detailed Steps

#### Step 1: Determine Tax Behavior for Cart

**Service**: `TaxBehaviorService.determineTaxBehaviorForCart(cart)`

**Process**:

1. **Cart-Level Determination**:
   - Determines tax behavior at the cart level
   - Applied consistently to all line items in the cart
   - Priority order:
     1. Country-based behavior (country mapping configuration)
     2. Merchant-wide default configuration
     3. Null (let Stripe use default behavior)

2. **Behavior Application**:
   - Returns Map of `{lineItemId: taxBehavior}`
   - All line items receive the same behavior (cart-level decision)
   - Behavior values: `'inclusive'`, `'exclusive'`, or `null`

3. **Logging**:
   - Logs the determined behavior for audit purposes
   - Logs decision reason for debugging

4. **Integration**:
   - Tax behavior is added to each line item in Stripe requests
   - Shipping cost carries the **same** behavior as the line items it ships, resolved from that
     request's destination — never a hardcoded value. See `business-rules/tax-calculation.md`
     Rule 6.

**Related Documentation**: See `process-tax-behavior-determination.md` for detailed tax behavior determination process.

#### Step 2: Get Categories for Products

**Service**: `CategoryService.getCategoriesForProducts(productIds, options)`

**Process**:

1. **Extract Product IDs**:
   - Extracts unique product IDs from cart line items
   - Filters out null/undefined values

2. **Fetch Categories**:
   - Calls category service to fetch categories from commercetools API
   - Uses Product Projections API with full expansion
   - Options:
     - `staged: false` (current version)
     - `locale: cart.locale` (if available)
     - `useCache: true` (5-minute TTL)

3. **Return Categories Map**:
   - Returns `Map<productId, Array<Category>>`
   - Each category includes custom fields and parent hierarchy

4. **Integration**:
   - Categories are used by tax code service to determine product tax codes
   - See: `process-category-taxcode-selection.md` for detailed tax code selection

**Related Documentation**: See `process-category-taxcode-selection.md` for detailed category retrieval and tax code selection process.

#### Step 3: Group Line Items by Ship-From Address

**Method**: `TaxOrchestratorService.groupLineItemsByShipFrom(cart)`

**Process**:

1. **Resolve Ship-From Addresses**:
   - Calls `shipFromService.resolveAllShipFromAddresses(cart.lineItems)`
   - Resolves addresses in parallel for all line items
   - Returns array of `{address, source}` objects

2. **Create Address Key**:
   - For each line item, creates unique key from address:
     - Uses `createAddressKey(shipFromInfo.address)`
     - Key format: JSON string of `{country, state, city, postal_code}`
     - If address is null: uses `'no_ship_from'` key

3. **Group by Address Key**:
   - Groups line items by address key using Map
   - Each group contains:
     - `shipFromAddress`: Stripe-formatted address
     - `source`: Source of address resolution
     - `lineItems`: Array of line items with this address

4. **Validation** (if `SHIP_FROM_REQUIRED='true'`):
   - Validates that all groups have valid ship-from addresses
   - Throws `ShipFromNotFoundError` if any group lacks address

5. **Return Groups**:
   - Returns array of ship-from groups
   - Each group will be processed separately to create Stripe requests

**Related Documentation**: See `process-ship-from-selection.md` for detailed ship-from address resolution process.

#### Step 4: Create Stripe Requests for Groups

**Method**: `TaxOrchestratorService.createRequestsForGroup(group, cart, taxBehaviors, categoriesMap)`

**Process**:

1. **Mode Detection**:
   - Checks `cart.shippingMode`:
     - `'Single'`: Calls `createSingleRequestForGroup()`
     - `'Multiple'`: Calls `createSeparatedRequestsByShippingKey()`

2. **Single Mode** (One Request):
   - Creates single request for entire group
   - Includes all line items from group
   - Single shipping cost from `cart.shippingInfo`

3. **Multiple Mode** (Multiple Requests):
   - Creates one request per shipping method
   - Each request includes only line items targeting that shipping method
   - Proportional amounts calculated for split line items
   - Each request has its own shipping cost

**Related Documentation**: See detailed request creation below.

#### Step 4a: Create Single Request for Group

**Method**: `TaxOrchestratorService.createSingleRequestForGroup(group, cart, taxBehaviors, categoriesMap)`

**Process**:

1. **Request Structure**:
   ```javascript
   {
     customer_details: {
       address: extractCustomerAddress(cart),
       address_source: 'shipping'
     },
     line_items: [],
     currency: cart.totalPrice.currencyCode,
     expand: ['line_items']
   }
   ```

2. **Ship-From Details** (if available):
   - Only includes `ship_from_details` if `group.shipFromAddress` exists
   - For digital products or optional ship-from, omits this field

3. **Add Line Items**:
   - For each line item in group:
     - Gets tax code: `taxCodeService.getTaxCodeForProduct(lineItem, categories)`
     - Creates line item data:
       - `amount`: `lineItem.totalPrice.centAmount`
       - `reference`: `lineItem.id`
       - `tax_code`: From tax code service
       - `quantity`: `lineItem.quantity`
       - `tax_behavior`: From taxBehaviors map (if determined)
       - `metadata`: Cart and customer info

4. **Add Shipping Cost**:
   - Gets shipping cost: `getShippingCostForGroup(cart)`
   - Gets shipping tax code: `taxCodeService.getShippingTaxCodeFromShippingInfo()`
   - Adds to request if amount exists

5. **Return Request**:
   - Returns single Stripe request object

**Related Documentation**: 
- Tax code selection: `process-category-taxcode-selection.md`
- Shipping tax code: `process-shipping-taxcode-selection.md`

#### Step 4b: Create Separated Requests by Shipping Key

**Method**: `TaxOrchestratorService.createSeparatedRequestsByShippingKey(group, cart, taxBehaviors, categoriesMap)`

**Process**:

1. **Iterate Shipping Methods**:
   - For each shipping method in `cart.shipping`:
     - Creates separate request with `shippingKey` for tracking

2. **Add Line Items** (Proportional):
   - For each line item in group:
     - Calls `buildLineItemForShippingMethod()` to get proportional data
     - Finds target quantity for this shipping method from `lineItem.shippingDetails.targets`
     - Calculates proportional amount: `(totalAmount * targetQuantity) / totalQuantity`
     - Only adds if `target.quantity > 0` and `amount > 0`

3. **Add Shipping Cost**:
   - Gets shipping cost for this specific shipping method
   - Gets shipping tax code for this shipping method
   - Adds to request if amount exists

4. **Filter Empty Requests**:
   - Only adds request if it has line items or shipping cost
   - Skips empty requests to avoid unnecessary Stripe API calls

5. **Return Requests**:
   - Returns array of Stripe request objects (one per shipping method)

**Proportional Amount Calculation**:
```javascript
const totalQuantity = lineItem.quantity;
const totalAmount = lineItem.totalPrice.centAmount;
const proportionalAmount = Math.round((totalAmount * target.quantity) / totalQuantity);
```

**Related Documentation**: 
- Tax code selection: `process-category-taxcode-selection.md`
- Shipping tax code: `process-shipping-taxcode-selection.md`

#### Step 5: Execute Tax Calculations in Parallel

**Method**: `TaxOrchestratorService.executeTaxCalculations(requests, stripeClient)`

**Process**:

1. **Parallel Execution**:
   - Uses `Promise.allSettled()` to execute all requests in parallel
   - Each request is sent to Stripe Tax API: `stripeClient.tax.calculations.create()`
   - Removes `shippingKey` from request before sending (internal tracking only)

2. **Result Processing**:
   - Separates successful and failed calculations
   - Filters: `calculations.filter(r => r.status === 'fulfilled')`
   - Extracts values: `.map(r => r.value)`

3. **Error Handling**:
   - Logs warnings for failed calculations
   - Continues with successful calculations
   - Throws error only if ALL calculations fail

4. **Return**:
   - Returns array of successful Stripe calculation responses
   - Each calculation includes:
     - `id`: Calculation ID
     - `line_items`: Tax breakdown per line item
     - `shipping_cost`: Shipping tax breakdown
     - `tax_breakdown`: General tax breakdowns
     - Other calculation metadata

**Performance**: All calculations execute in parallel, significantly reducing total execution time compared to sequential execution.

#### Step 6: Create Update Actions

**Service**: `UpdateActionService.createCartUpdateActionsFromMultipleCalculations(calculations, shippingInfoGroups, requests, cart)`

**Process**:

1. **Input Parameters**:
   - `calculations`: Array of successful Stripe calculation responses
   - `shippingInfoGroups`: Array of shipping info with shippingKey (for Multiple mode)
   - `requests`: Array of original Stripe requests (for mapping)
   - `cart`: Original commercetools cart

2. **Action Creation** (in order):
   - **Step 1**: Combines calculations for cart metadata (custom type fields only)
   - **Step 2**: Creates cart custom type update action with combined metadata
   - **Step 3a**: Creates line item total price actions (`setLineItemTotalPrice`) - REQUIRED for ExternalAmount mode
   - **Step 3b**: Creates line item tax update actions (`setLineItemTaxAmount`) with shipping key mapping
   - **Step 4**: Creates shipping tax update actions (one per shipping method in Multiple mode, or single in Single mode)
   - **Step 5**: Creates cart total tax action (`setCartTotalTax`) - REQUIRED for ExternalAmount mode

3. **Return**:
   - Returns array of commercetools update actions
   - Actions ready to be applied to cart via commercetools API
   - Actions are ordered correctly for CommerceTools processing

**Important Notes**:
- Line item total price actions must be created BEFORE tax actions
- All line items with `setLineItemTotalPrice` must also have `setLineItemTaxAmount` (zero-tax if needed)
- Cart total tax action is required for ExternalAmount tax mode in CommerceTools

**Related Documentation**: See `process-update-action-creation.md` for detailed update action creation process.

## Implementation Details

### Service Integration

The orchestrator integrates the following services:

1. **TaxBehaviorService**:
   - Determines cart-level tax behavior
   - Applied to all line items consistently

2. **CategoryService**:
   - Retrieves product categories from commercetools API
   - Provides categories for tax code selection
   - Uses caching for performance

3. **ShipFromService**:
   - Resolves ship-from addresses for line items
   - Uses fallback strategies (line item channel → inventory → default)
   - Returns address with source information

4. **TaxCodeService**:
   - Determines tax codes for products (from categories)
   - Determines tax codes for shipping methods
   - Uses hierarchical category search

5. **UpdateActionService**:
   - Transforms Stripe calculations into commercetools actions
   - Handles shipping key mapping
   - Combines duplicate line items

### Single vs Multiple Shipping Mode

**Single Mode** (`cart.shippingMode === 'Single'`):

1. **Request Creation**:
   - One request per ship-from group
   - All line items included in each request
   - Single shipping cost from `cart.shippingInfo`

2. **Shipping Key**:
   - No shippingKey in requests
   - No shippingKey in update actions

3. **Request Count**:
   - Number of requests = number of ship-from groups
   - Typically 1-3 requests depending on ship-from diversity

**Multiple Mode** (`cart.shippingMode === 'Multiple'`):

1. **Request Creation**:
   - One request per (ship-from group × shipping method)
   - Line items split proportionally across shipping methods
   - Each shipping method has its own shipping cost

2. **Shipping Key**:
   - shippingKey included in request metadata (for tracking)
   - shippingKey required in update actions (commercetools requirement)

3. **Request Count**:
   - Number of requests = (ship-from groups) × (shipping methods)
   - Can be many requests for complex scenarios

4. **Proportional Calculation**:
   - Line items split by `shippingDetails.targets`
   - Amount calculated: `(totalAmount * targetQuantity) / totalQuantity`
   - Ensures precise tax calculation per shipping method

### Ship-From Grouping Rules

**Grouping Logic**:

1. **Address Key Creation**:
   - Key based on: `{country, state, city, postal_code}`
   - Null address → `'no_ship_from'` key
   - Uses JSON.stringify for consistent key generation

2. **Group Structure**:
   ```javascript
   {
     shipFromAddress: StripeAddress,
     source: 'lineItem.supplyChannel' | 'inventory.supplyChannel' | 'default_business' | 'not_required',
     lineItems: Array<LineItem>
   }
   ```

3. **Validation**:
   - If `SHIP_FROM_REQUIRED='true'`:
     - Validates all groups have `shipFromAddress.country`
     - Throws `ShipFromNotFoundError` if validation fails

### Request Creation Rules

**Request Structure**:

1. **Required Fields**:
   - `customer_details.address`: **the delivery address, in full — country included.** Stripe
     treats this as "the customer's location, or transaction destination", so its country selects
     the tax jurisdiction. It is never assembled from more than one cart field: see
     [ADR-007](../decisions/adr-007-tax-destination-country.md).
   - `line_items`: Array of line items with tax codes
   - `currency`: Cart currency code

2. **Optional Fields**:
   - `ship_from_details.address`: Only if address available
   - `shipping_cost`: Only if shipping cost exists
   - `shippingKey`: Only in Multiple mode (internal tracking)

3. **Line Item Fields**:
   - `amount`: Line item total price (or proportional in Multiple mode)
   - `reference`: Line item ID
   - `tax_code`: From category tax code selection
   - `quantity`: Line item quantity (or target quantity in Multiple mode)
   - `tax_behavior`: From tax behavior service (if determined)
   - `metadata`: Cart and customer info, shippingKey

4. **Shipping Cost Fields**:
   - `amount`: Shipping cost amount
   - `tax_code`: From shipping method tax code selection
   - `tax_behavior`: the behavior resolved for the line items **in this same request** — i.e. for
     this request's destination — omitted entirely when none was resolved, so the account's own
     Stripe Tax setting applies. Never a hardcoded literal.

### Proportional Amount Calculation

**When Used**: Multiple shipping mode with line items split across shipping methods

**Calculation Formula**:
```javascript
const totalQuantity = lineItem.quantity;
const totalAmount = lineItem.totalPrice.centAmount;
const targetQuantity = target.quantity; // From shippingDetails.targets
const proportionalAmount = Math.round((totalAmount * targetQuantity) / totalQuantity);
```

**Example**:
- Line item: $100.00, quantity: 10
- Shipping method A: quantity: 6
- Shipping method B: quantity: 4
- Amount for A: `Math.round((10000 * 6) / 10) = 6000` ($60.00)
- Amount for B: `Math.round((10000 * 4) / 10) = 4000` ($40.00)

**Precision**: Uses `Math.round()` to handle cent amounts correctly.

### Parallel Execution Strategy

**Implementation**:
- Uses `Promise.allSettled()` instead of `Promise.all()`
- Allows partial success (some calculations succeed, some fail)
- Continues with successful calculations

**Error Handling**:
- Failed calculations are logged but don't stop the flow
- Only throws error if ALL calculations fail
- Successful calculations are processed normally

**Performance**:
- All calculations execute simultaneously
- Total time ≈ longest single calculation time
- Significantly faster than sequential execution

### Shipping Info Groups Tracking

**Purpose**: Track which shipping method each calculation corresponds to (Multiple mode only)

**Structure**:
```javascript
{
  shippingKey: 'shipping-method-key',
  taxCode: 'txcd_99999999' | null,
  lineItems: ['line-item-id-1', 'line-item-id-2'],
  hasShippingCost: true | false
}
```

**Usage**:
- Used by update action service to map calculations to shipping methods
- Enables proper shipping key association in update actions
- Only created in Multiple mode

## Usage Example

### Complete Flow Example

```javascript
// 1. API Extension receives cart (in tax.calculator.controller.js → taxHandler)
const cart = request.body.resource.obj;

// 2. Orchestrate tax calculation
const result = await taxOrchestratorService.orchestrateTaxCalculation(cart);
// result === { actions: [ ... ] }

// 3. Return update actions to commercetools
// taxHandler responds with HTTP 200 (HTTP_STATUS_SUCCESS_ACCEPTED) and the result body.
// CT extensions accept any 2xx — the connector uses 200 for tax-calculator (misnamed constant; value is 200).
return response.status(200).send(result);
```

### Single Mode Flow

```javascript
// Cart with Single shipping mode
const cart = {
  shippingMode: 'Single',
  lineItems: [
    { id: 'L1', productId: 'P1', totalPrice: { centAmount: 10000 } },
    { id: 'L2', productId: 'P2', totalPrice: { centAmount: 20000 } }
  ],
  shippingInfo: {
    price: { centAmount: 500 },
    shippingMethod: { id: 'SM1' }
  }
};

// Result: 1-3 Stripe requests (depending on ship-from groups)
// Result: Update actions without shippingKey
```

### Multiple Mode Flow

```javascript
// Cart with Multiple shipping mode
const cart = {
  shippingMode: 'Multiple',
  lineItems: [
    {
      id: 'L1',
      productId: 'P1',
      quantity: 10,
      totalPrice: { centAmount: 10000 },
      shippingDetails: {
        targets: [
          { shippingMethodKey: 'SM1', quantity: 6 },
          { shippingMethodKey: 'SM2', quantity: 4 }
        ]
      }
    }
  ],
  shipping: [
    { shippingKey: 'SM1', shippingInfo: { price: { centAmount: 300 } } },
    { shippingKey: 'SM2', shippingInfo: { price: { centAmount: 200 } } }
  ]
};

// Result: 2-6 Stripe requests (ship-from groups × shipping methods)
// Result: Update actions with shippingKey for each shipping method
```

## Technical Notes

### Performance Considerations

- **Parallel Category Fetching**: Categories fetched in single batch API call
- **Parallel Ship-From Resolution**: All ship-from addresses resolved in parallel
- **Parallel Stripe Calculations**: All tax calculations executed simultaneously
- **Caching**: Category service uses 5-minute cache to reduce API calls
- **Request Optimization**: Empty requests filtered out to avoid unnecessary Stripe calls

### Edge Cases Handled

- **Empty Carts**: Handles carts with no line items gracefully
- **Missing Ship-From**: Handles optional ship-from mode (returns null addresses)
- **Required Ship-From**: Validates ship-from when `SHIP_FROM_REQUIRED='true'`
- **Failed Calculations**: Continues with successful calculations using Promise.allSettled
- **All Calculations Failed**: Throws error if no calculations succeed
- **Missing Categories**: Handles products without categories (tax code service throws error)
- **Missing Tax Codes**: Tax code service throws error if no tax code found
- **Empty Shipping Methods**: Filters out empty requests in Multiple mode
- **Proportional Rounding**: Handles rounding errors in proportional calculations

### Logging and Debugging

- **Orchestration Start**: Logs cart ID, shipping mode, line items count
- **Tax Behavior**: Logs determined tax behavior
- **Ship-From Groups**: Logs group count and details
- **Request Preparation**: Logs request count and shipping methods count
- **Calculation Execution**: Logs each calculation with details
- **Calculation Results**: Logs successful/failed counts and calculation IDs
- **Update Actions**: Logs action count and calculation references
- **Error Logging**: Comprehensive error logging with context

### Error Handling

**Error Types**:

1. **TaxCodeNotFoundError**:
   - Thrown when product tax code cannot be determined
   - Stops orchestration, requires configuration fix

2. **ShipFromNotFoundError**:
   - Thrown when ship-from required but not found
   - Only when `SHIP_FROM_REQUIRED='true'`

3. **InvalidTaxDestinationError**:
   - Thrown when the delivery address names a city, postal code or street but no country
   - Stops orchestration; mapped to a commercetools `InvalidInput` 400 naming the offending
     shipping method. The address is refused rather than completed from `cart.country` — see
     `../decisions/adr-007-tax-destination-country.md`
   - An entirely absent delivery address is **not** an error: the request falls back to
     `cart.country` as a country-only address

4. **Stripe API Errors**:
   - Individual calculation failures logged but don't stop flow
   - Only fails if ALL calculations fail

5. **Unexpected Errors**:
   - Logged with full context
   - Propagated to caller for handling

## Configuration Requirements

### Environment Variables

1. **SHIP_FROM_REQUIRED** (optional):
   - Values: `'true'` or any other value
   - When `'true'`: Ship-from is required, validates all groups have addresses
   - When not `'true'`: Ship-from is optional, allows null addresses

### commercetools Setup

1. **Cart Structure**:
   - Cart must have `lineItems` array
   - Cart must have `shippingMode` ('Single' or 'Multiple')
   - Cart must have `totalPrice.currencyCode`
   - `cart.country` selects **prices** only. It is not the tax destination and never reaches
     Stripe as one — it is used solely as the country of an otherwise empty address, for a cart
     that has not collected a delivery address yet.

2. **Single Mode Requirements**:
   - `cart.shippingInfo` with shipping method and price
   - `cart.shippingAddress` — the tax destination, country included

3. **Multiple Mode Requirements**:
   - `cart.shipping` array with shipping methods
   - Each shipping method must have `shippingKey`
   - Each shipping method carries **its own** delivery address, and therefore its own tax
     destination. A cart delivering to two countries produces one request per destination, each
     taxed where its goods actually go.
   - Line items must have `shippingDetails.targets` for proportional splitting

4. **Destination Requirements** (SB3-218):
   - A delivery address that is present must carry its own `country`. commercetools requires it
     on every Address, so an address naming a city, postal code or street without one cannot
     arrive through the cart API — it is rejected with a commercetools `InvalidInput` error
     rather than completed from `cart.country`.
   - An entirely absent delivery address is not an error: the request falls back to
     `cart.country` as a country-only address, so a cart still calculates before the shopper has
     entered one.

### Stripe Configuration

1. **Stripe API Key**:
   - Must be configured in Stripe client
   - Used for tax calculation API calls

2. **Tax Code Configuration**:
   - Product tax codes configured in category custom fields
   - Shipping tax codes configured in shipping method custom fields

## Related Documentation

- `process-tax-behavior-determination.md`: Tax behavior determination process
- `process-category-taxcode-selection.md`: Product tax code selection from categories
- `process-ship-from-selection.md`: Ship-from address resolution process
- `process-shipping-taxcode-selection.md`: Shipping tax code selection process
- `process-update-action-creation.md`: Update action creation from calculations

## Summary

The process of tax orchestration is a comprehensive coordination system that:

1. **Determines tax behavior** at the cart level for consistent application
2. **Retrieves categories** from commercetools API with caching for tax code selection
3. **Groups line items** by ship-from address for accurate origin-based calculations
4. **Creates Stripe requests** separated by shipping key in Multiple mode for precision
5. **Executes calculations** in parallel for optimal performance
6. **Transforms results** into commercetools update actions with proper mapping
7. **Handles errors** gracefully with partial success support

This system ensures efficient, accurate, and maintainable tax calculation orchestration by coordinating all specialized services in the correct sequence, handling complex scenarios like multiple shipping methods and ship-from addresses, and providing comprehensive error handling and logging throughout the process.
