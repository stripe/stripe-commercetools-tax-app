# Process Update Action Creation

## Description

The process of update action creation is a transformation mechanism implemented in the update-action service. This system converts Stripe tax calculation responses into commercetools cart update actions, enabling the application of calculated taxes to carts and line items in the commercetools platform.

The process is designed to handle complex scenarios where multiple Stripe tax calculations may be generated (due to multiple shipping methods, ship-from addresses, or shipping keys), and these calculations must be properly mapped and combined to create accurate update actions for the cart. The solution uses a combination strategy for metadata while preserving individual calculation precision for line items and shipping costs.

**Main Flow**: The system receives multiple Stripe tax calculation responses from the orchestrator, combines them for cart metadata purposes, maps calculations to shipping keys for Multiple shipping mode, creates line item tax update actions with proper shipping key association, and creates shipping tax update actions for each shipping method. The system ensures that tax breakdowns are correctly matched to line items and shipping costs using multiple matching strategies.

## Problem

E-commerce platforms like commercetools require update actions to apply external tax calculations to carts:
- Multiple Stripe calculations may be generated for a single cart (due to multiple shipping methods or ship-from addresses)
- Line items must be associated with shipping keys in Multiple shipping mode
- Tax breakdowns from Stripe are not explicitly labeled, requiring matching logic
- Shipping costs must be mapped to their corresponding shipping methods
- Duplicate line items (same lineItemId + shippingKey) across calculations must be combined
- Cart metadata must be aggregated from all calculations
- Tax breakdowns must be found using multiple fallback strategies

The main challenges addressed by this solution include:

1. **Multiple Calculation Handling**: Multiple Stripe calculations must be processed and mapped correctly to their corresponding shipping methods or ship-from groups.

2. **Shipping Key Mapping**: In Multiple shipping mode, line items and shipping costs must be correctly associated with their shipping keys for commercetools API requirements.

3. **Tax Breakdown Matching**: Stripe returns tax breakdowns as a general array without explicit labels, requiring intelligent matching logic to identify which breakdown corresponds to which line item or shipping cost.

4. **Duplicate Combination**: When the same line item appears in multiple calculations (same lineItemId + shippingKey), tax amounts must be combined and effective rates calculated accurately.

5. **Metadata Aggregation**: Cart custom type metadata must be aggregated from all calculations while preserving individual calculation precision for line items and shipping.

6. **Fallback Strategies**: Multiple strategies are needed to find tax breakdowns when direct matching fails.

## Solution Found

The solution implements a multi-step transformation algorithm that:

1. **Combines calculations for metadata**: Aggregates all calculations into a single combined result for cart custom type metadata only
2. **Maps calculations to shipping keys**: Uses metadata or request mapping to associate calculations with their shipping keys
3. **Creates line item actions**: Processes each calculation individually to create line item tax update actions with shipping key association
4. **Handles duplicates**: Combines duplicate line items (same lineItemId + shippingKey) with accurate effective rate calculation
5. **Creates shipping actions**: Maps shipping costs to shipping methods and creates shipping tax update actions
6. **Finds tax breakdowns**: Uses multiple strategies to match tax breakdowns to line items and shipping costs

### Key Features

- **Selective Combination**: Combines calculations only for cart metadata, preserving individual calculation precision for line items and shipping
- **Shipping Key Mapping**: Intelligent mapping of calculations to shipping keys using metadata or request-based mapping
- **Duplicate Handling**: Combines duplicate line items with precise effective rate calculation based on base amounts
- **Tax Breakdown Matching**: Multiple strategies for finding tax breakdowns (direct calculation, most common tax type, exact amount)
- **Single/Multiple Mode Support**: Handles both Single and Multiple shipping modes appropriately
- **Zero Tax Handling**: Creates zero-tax actions when shipping costs have no tax
- **Comprehensive Error Handling**: Graceful handling of missing breakdowns and edge cases

## Solution Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│              Tax Orchestrator Service                            │
│         orchestrateTaxCalculation(cart)                         │
│                                                                   │
│  - Executes multiple Stripe tax calculations                     │
│  - Returns: Array<StripeCalculation>                            │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│  createCartUpdateActionsFromMultipleCalculations()              │
│  Update Action Service Entry Point                               │
│                                                                   │
│  Input:                                                          │
│  - calculations: Array<StripeCalculation>                     │
│  - shippingInfoGroups: Array<{shippingKey, ...}>                │
│  - requests: Array<StripeRequest>                                │
│  - cart: CommercetoolsCart                                       │
└───────────────────────┬─────────────────────────────────────────┘
                        │
        ┌───────────────┴───────────────┐
        │                               │
        ▼                               ▼
┌───────────────────────┐   ┌───────────────────────┐
│  STEP 1: Combine      │   │  STEP 2: Create Cart  │
│  Calculations         │   │  Custom Type Action   │
│  (metadata only)       │   │                       │
└───────────┬───────────┘   └───────────┬───────────┘
            │                           │
            └───────────┬───────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 3a: Create Line Item Total Price Actions                  │
│  createLineItemTotalPriceActions()                              │
│  - Sets totalPrice to base amount (without taxes)              │
│  - Required for ExternalAmount tax mode                        │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 3b: Create Line Item Tax Update Actions                   │
│  createLineItemTaxUpdateActions()                                │
└───────────────────────┬─────────────────────────────────────────┘
                        │
            ┌───────────┴───────────┐
            │                       │
            ▼                       ▼
    ┌───────────────┐      ┌───────────────┐
    │ Map           │      │ Process Each  │
    │ Calculations  │      │ Calculation   │
    │ to            │      │ Individually  │
    │ shippingKeys  │      │               │
    └───────┬───────┘      └───────┬───────┘
            │                     │
            └───────────┬─────────┘
                        │
                        ▼
    ┌───────────────────────────────────────┐
    │ Find Tax Breakdown for Each Line Item │
    │ (Multiple Strategies)                  │
    └───────────┬───────────────────────────┘
                │
                ▼
    ┌───────────────────────────────────────┐
    │ Handle Duplicates                     │
    │ Combine (lineItemId + shippingKey)    │
    │ Calculate Effective Rate              │
    └───────────┬───────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 4: Create Shipping Tax Update Actions                    │
│  createMultipleShippingTaxUpdateActions() (Multiple mode)      │
│  OR                                                             │
│  createShippingTaxUpdateAction() (Single mode)                 │
└───────────────────────┬─────────────────────────────────────────┘
                        │
            ┌───────────┴───────────┐
            │                       │
            ▼                       ▼
    ┌───────────────┐      ┌───────────────┐
    │ Map           │      │ Find Tax      │
    │ Calculations  │      │ Breakdown     │
    │ to            │      │ (Multiple    │
    │ shippingKeys  │      │ Strategies)   │
    └───────┬───────┘      └───────┬───────┘
            │                     │
            └───────────┬─────────┘
                        │
                        ▼
    ┌───────────────────────────────────────┐
    │ Create Action per Shipping Method     │
    │ (with shippingKey)                     │
    └───────────┬───────────────────────────┘
                │
                ▼
        ┌───────────────┐
        │ Return Array  │
        │ of Update     │
        │ Actions       │
        └───────────────┘
```

## Step-by-Step Solution Description

### Overview Flow

1. **Entry Point**: The Tax Orchestrator Service calls `createCartUpdateActionsFromMultipleCalculations()` with multiple Stripe calculations
2. **Combine Calculations**: Combines all calculations for cart metadata (custom type fields only)
3. **Create Cart Action**: Creates cart custom type update action with combined metadata
4. **Create Line Item Total Price Actions**: Creates `setLineItemTotalPrice` actions to set base prices (without taxes) - REQUIRED for ExternalAmount mode
5. **Create Line Item Tax Actions**: Processes each calculation to create line item tax update actions with shipping key mapping
6. **Handle Duplicates**: Combines duplicate line items (same lineItemId + shippingKey) with effective rate calculation
7. **Create Shipping Actions**: Creates shipping tax update actions for each shipping method (Single or Multiple mode)
8. **Create Cart Total Tax Action**: Creates `setCartTotalTax` action to set cart's total gross amount - REQUIRED for ExternalAmount mode
9. **Return Actions**: Returns array of all update actions for commercetools API

### Detailed Steps

#### Step 1: Entry Point - Create Cart Update Actions from Multiple Calculations

**Method**: `UpdateActionService.createCartUpdateActionsFromMultipleCalculations(calculations, shippingInfoGroups, requests, cart)`

**Parameters**:
- `calculations`: Array of Stripe tax calculation response objects
- `shippingInfoGroups`: Array of shipping info groups with shippingKey (for Multiple mode)
- `requests`: Array of Stripe request objects (for mapping)
- `cart`: Commercetools cart object

**Process**:

1. **Combine Calculations** (for metadata only):
   - Calls `combineCalculations(calculations)` to aggregate metadata
   - This combination is ONLY used for cart custom type metadata
   - Line items and shipping are processed individually to preserve precision

2. **Create Cart Custom Type Action**:
   - Calls `createCartCustomTypeUpdateAction(combinedCalculation)`
   - Creates `setCustomType` action for cart metadata

3. **Create Line Item Total Price Actions** (REQUIRED for ExternalAmount mode):
   - Calls `createLineItemTotalPriceActions(calculations, shippingInfoGroups)`
   - Creates `setLineItemTotalPrice` actions for each line item
   - Sets totalPrice to base amount (without taxes)
   - Must be executed BEFORE tax actions

4. **Create Line Item Tax Actions**:
   - Calls `createLineItemTaxUpdateActions(calculations, shippingInfoGroups, lineItemTotalPriceActions, cart)`
   - Processes each calculation individually
   - Maps calculations to shipping keys
   - Handles duplicates
   - Ensures all line items with `setLineItemTotalPrice` also have tax actions

5. **Create Shipping Actions**:
   - If `shippingInfoGroups.length > 0` (Multiple mode):
     - Calls `createMultipleShippingTaxUpdateActions(calculations, shippingInfoGroups, requests, cart)`
   - Else (Single mode):
     - Calls `createShippingTaxUpdateAction(combinedCalculation)`

6. **Create Cart Total Tax Action** (REQUIRED for ExternalAmount mode):
   - Calls `createCartTotalTaxAction(combinedCalculation)`
   - Creates `setCartTotalTax` action with `externalTotalGross`
   - Sets cart's `taxedPrice.totalGross` for CommerceTools tax calculation

7. **Return Actions**:
   - Returns array of all update actions

#### Step 2: Combine Calculations (Metadata Only)

**Method**: `UpdateActionService.combineCalculations(calculations)`

**Process**:

1. **Aggregate Line Items**:
   - Flattens all line items from all calculations: `calculations.flatMap(calc => calc.line_items?.data || [])`

2. **Aggregate Tax Breakdowns**:
   - Flattens all tax breakdowns: `calculations.flatMap(calc => calc.tax_breakdown || [])`
   - Flattens all shipping tax breakdowns: `calculations.flatMap(calc => calc.shipping_cost?.tax_breakdown || [])`

3. **Sum Amounts**:
   - `amount_total`: Sum of all `amount_total` values
   - `tax_amount_exclusive`: Sum of all `tax_amount_exclusive` values
   - `tax_amount_inclusive`: Sum of all `tax_amount_inclusive` values
   - `shipping_cost.amount`: Sum of all shipping amounts
   - `shipping_cost.amount_tax`: Sum of all shipping tax amounts

4. **Collect References**:
   - `calculation_references`: Array of all calculation IDs
   - `currencies`: Array of all currencies (uppercase)
   - `expires_at`: Array of all expiration timestamps (ISO format)

5. **Return Combined Object**:
   - Returns combined calculation object for metadata use only

**Important Note**: This combination is ONLY used for cart custom type metadata. Line items and shipping costs are processed directly from individual calculations to preserve shipping key mapping and breakdown precision.

#### Step 3: Create Cart Custom Type Update Action

**Method**: `UpdateActionService.createCartCustomTypeUpdateAction(calculation)`

**Process**:

1. **Action Structure**:
   - Creates `setCustomType` action
   - Sets custom type key: `CART_TAX_CUSTOM_TYPE.key`

2. **Field Mapping**:
   - `CALCULATION_REFERENCES`: Array of calculation IDs
   - `AMOUNT_TOTAL`: Total amount from all calculations
   - `TAX_AMOUNT_EXCLUSIVE`: Exclusive tax amount
   - `TAX_AMOUNT_INCLUSIVE`: Inclusive tax amount
   - `CURRENCIES`: Array of currencies
   - `EXPIRES_AT`: Array of expiration timestamps
   - `CALCULATION_TIMESTAMP`: Current timestamp (ISO format)

3. **Return**:
   - Returns commercetools `setCustomType` update action

#### Step 3a: Create Line Item Total Price Actions

**Method**: `UpdateActionService.createLineItemTotalPriceActions(calculations, shippingInfoGroups)`

**Process**:

1. **Purpose**:
   - Creates `setLineItemTotalPrice` actions for each line item
   - Sets `totalPrice` to the base amount (without taxes)
   - This is REQUIRED for ExternalAmount tax mode in CommerceTools
   - Allows CommerceTools to correctly calculate `totalTax = totalGross - totalNet`

2. **Map Calculations to Shipping Keys**:
   - Uses `mapCalculationsToShippingKeys()` to associate calculations with shipping keys
   - Enables proper shipping key assignment in Multiple mode

3. **Process Each Calculation**:
   - For each calculation:
     - Gets shippingKey from mapping (or null for Single mode)
     - For each line item in the calculation:
       - Creates `setLineItemTotalPrice` action with:
         - `lineItemId`: From `lineItemData.reference`
         - `externalTotalPrice.price.centAmount`: Unit price (amount / quantity)
         - `externalTotalPrice.totalPrice.centAmount`: Total base amount (without taxes)
         - `shippingKey`: Added if available (Multiple mode)

4. **Handle Duplicates**:
   - Groups actions by key: `${lineItemId}-${shippingKey || 'single'}`
   - If duplicate found:
     - Combines totalPrice amounts
     - Recalculates unit price based on combined quantity
     - Ensures accurate pricing for split line items

5. **Return**:
   - Returns array of `setLineItemTotalPrice` actions
   - These actions must be applied BEFORE tax actions

**Important Notes**:
- This step is CRITICAL for ExternalAmount tax mode
- `setLineItemTotalPrice` changes the line item's `priceMode` to `ExternalTotal`
- CommerceTools requires all `ExternalTotal` line items to also have `externalTaxAmount` set
- The base amount (without taxes) is stored in `totalPrice`, allowing CommerceTools to calculate tax correctly

#### Step 3b: Create Line Item Tax Update Actions

**Method**: `UpdateActionService.createLineItemTaxUpdateActions(calculations, shippingInfoGroups, lineItemTotalPriceActions, cart)`

**Process**:

1. **Map Calculations to Shipping Keys**:
   - **STRATEGY 1**: Extract shippingKey from line item metadata (most reliable)
     - Checks `lineItems[0].metadata.shippingKey` in each calculation
     - All line items in a calculation have the same shippingKey
   - **STRATEGY 2**: Use shippingInfoGroups as fallback (backward compatibility)
     - Maps by index if metadata is not available

2. **Process Each Calculation**:
   - For each calculation:
     - Gets shippingKey from mapping (or null for Single mode)
     - Calls `createLineItemActionsFromCalculation(calculation, shippingKey)`
     - Collects all actions

3. **Handle Duplicates**:
   - Groups actions by key: `${lineItemId}-${shippingKey || 'single'}`
   - If duplicate found:
     - Combines tax amounts: `existing.centAmount + new.centAmount`
     - Calculates effective rate: `combinedTaxAmount / totalBaseAmount`
     - If base amount is 0, averages rates: `(existingRate + newRate) / 2`
   - Removes temporary `_baseAmount` field

4. **Ensure Coverage** (CRITICAL):
   - Checks that all line items with `setLineItemTotalPrice` also have `setLineItemTaxAmount`
   - If a line item has `setLineItemTotalPrice` but no tax calculation:
     - Creates a tax action with `tax = 0` to satisfy CommerceTools requirement
     - This is required because `ExternalTotal` line items must have `externalTaxAmount` set
   - The `taxRate.country` on these zero-tax actions is resolved by `destinationCountryOf()` —
     tax breakdowns first, then `customer_details.address` as echoed back by Stripe. It is never
     taken from `cart.country`, which selects prices and is shopper-controlled. The amount is
     zero either way, but the country recorded on the cart must name the delivery jurisdiction
     the calculation was actually made for. See `../decisions/adr-007-tax-destination-country.md`.

5. **Return**:
   - Returns array of `setLineItemTaxAmount` actions

#### Step 5: Create Line Item Actions from Calculation

**Method**: `UpdateActionService.createLineItemActionsFromCalculation(calculation, shippingKey)`

**Process**:

1. **Extract Line Items**:
   - Gets `calculation.line_items.data` array
   - Gets `calculation.tax_breakdown` array

2. **For Each Line Item**:
   - Finds tax breakdown using `findTaxBreakdownForLineItem()`
   - If breakdown found:
     - Creates `setLineItemTaxAmount` action with:
       - `lineItemId`: From `lineItemData.reference`
       - `externalTaxAmount.totalGross.centAmount`: From `lineItemData.amount_tax`
       - `externalTaxAmount.taxRate`: From breakdown `tax_rate_details`
       - `shippingKey`: Added if available (Multiple mode - REQUIRED)
     - Stores `_baseAmount` for effective rate calculation if duplicates

3. **Return**:
   - Returns array of line item tax update actions

#### Step 6: Find Tax Breakdown for Line Item

**Method**: `UpdateActionService.findTaxBreakdownForLineItem(lineItemTaxData, taxBreakdowns)`

**Process**:

1. **STRATEGY 1: Search by Calculated Tax Amount** (Highest Priority):
   - For each breakdown:
     - Calculates expected tax: `lineItemData.amount * (percentage_decimal / 100)`
     - Compares with actual tax: `lineItemData.amount_tax`
     - If difference <= 1 cent, returns breakdown
   - This is the most accurate matching strategy

2. **STRATEGY 2: Search by Most Common Tax Type** (Fallback):
   - Counts occurrences of each tax type in breakdowns
   - Finds most common tax type
   - Returns first breakdown with that tax type
   - Used when direct calculation matching fails

3. **Return**:
   - Returns matching breakdown or `null`

#### Step 4: Create Shipping Tax Update Actions

#### Step 4a: Create Multiple Shipping Tax Update Actions (Multiple Mode)

**Method**: `UpdateActionService.createMultipleShippingTaxUpdateActions(calculations, shippingInfoGroups, requests, cart)`

**Process**:

1. **Map Shipping Info by Key**:
   - Creates Map of shippingInfo by shippingKey
   - Maps from `shippingInfoGroups` array

2. **Map Calculations to Shipping Keys**:
   - Calls `mapCalculationsByShippingKey()` to map calculations
   - Combines shipping costs when multiple calculations share same shippingKey

3. **Get Shipping Keys to Process**:
   - If cart has shipping methods: Uses `cart.shipping[].shippingKey`
   - Else: Uses keys from `shippingInfoByKey`

4. **For Each Shipping Key**:
   - Gets mapped calculation data
   - If no shipping cost or tax <= 0:
     - Creates zero-tax action using `createZeroTaxShippingAction()`
   - Else:
     - Finds tax breakdown using `findOrCreateShippingTaxBreakdown()`
     - If breakdown found:
       - Creates `setShippingMethodTaxAmount` action with shippingKey
     - Else:
       - Creates zero-tax action

5. **Return**:
   - Returns array of shipping tax update actions

#### Step 4b: Create Shipping Tax Update Action (Single Mode)

**Method**: `UpdateActionService.createShippingTaxUpdateAction(calculation)`

**Process**:

1. **Check Shipping Cost**:
   - Gets shipping amount and tax amount from `calculation.shipping_cost`
   - If no shipping cost or tax <= 0, creates zero-tax action

2. **Find Tax Breakdown**:
   - Uses multiple strategies to find tax breakdown:
     - STRATEGY 1: Search in `shipping_cost.tax_breakdown`
     - STRATEGY 2: Search in general `tax_breakdown`
     - STRATEGY 3: Find by exact amount match

3. **Create Action**:
   - Creates `setShippingMethodTaxAmount` action (no shippingKey in Single mode)
   - Sets `externalTaxAmount.totalGross` = shipping amount + tax amount
   - Sets `externalTaxAmount.taxRate` from breakdown

4. **Return**:
   - Returns shipping tax update action or null

#### Step 5: Create Cart Total Tax Action

**Method**: `UpdateActionService.createCartTotalTaxAction(calculation)`

**Process**:

1. **Purpose**:
   - Creates `setCartTotalTax` action
   - Sets cart's `taxedPrice.totalGross` to the total amount from Stripe
   - This is REQUIRED for ExternalAmount tax mode in CommerceTools
   - Allows CommerceTools to correctly calculate cart-level taxes

2. **Validation**:
   - Checks if `calculation.amount_total` exists and is > 0
   - If missing or zero, returns null (logs warning)

3. **Action Structure**:
   ```javascript
   {
     action: "setCartTotalTax",
     externalTotalGross: {
       currencyCode: calculation.currency.toUpperCase(),
       centAmount: calculation.amount_total
     }
   }
   ```

4. **Important Notes**:
   - `amount_total` from Stripe already includes: line items + shipping + taxes
   - This action sets the cart's total gross amount for CommerceTools tax calculation
   - CommerceTools uses this to calculate `totalTax = totalGross - totalNet`

5. **Return**:
   - Returns `setCartTotalTax` action or null if amount_total is missing

#### Step 6: Map Calculations by Shipping Key

**Method**: `UpdateActionService.mapCalculationsByShippingKey(calculations, requests, shippingInfoGroups, shippingInfoByKey)`

**Process**:

1. **STRATEGY 1: Use Requests** (Most Reliable):
   - If requests provided:
     - Maps by index: `requests[i].shippingKey` → `calculations[i]`
     - If shippingKey already exists in map:
       - Combines shipping costs using `combineShippingCosts()`
     - Else:
       - Adds new entry to map

2. **STRATEGY 2: Use ShippingInfoGroups** (Fallback):
   - If no requests:
     - Maps by index: `shippingInfoGroups[i].shippingKey` → `calculations[i]`
     - Logs warning about potential inaccuracy
     - Combines if duplicate shippingKey found

3. **Return**:
   - Returns Map of `{calculation, shippingInfo}` by shippingKey

#### Step 7: Find or Create Shipping Tax Breakdown

**Method**: `UpdateActionService.findOrCreateShippingTaxBreakdown(calculation, shippingAmount, shippingTaxAmount)`

**Process**:

1. **STRATEGY 1: Find in Shipping Tax Breakdown**:
   - Calls `findByDirectCalculation()` on `calculation.shipping_cost.tax_breakdown`
   - Uses shipping amount and tax amount for matching

2. **STRATEGY 2: Find in General Tax Breakdown**:
   - If not found, calls `findByDirectCalculation()` on `calculation.tax_breakdown`

3. **STRATEGY 3: Create from First Breakdown**:
   - If not found and amounts > 0:
     - Calculates effective rate: `shippingTaxAmount / shippingAmount`
     - Uses first breakdown as template
     - Updates amount and percentage_decimal

4. **Return**:
   - Returns tax breakdown or `null`

#### Step 8: Find Tax Breakdown by Direct Calculation

**Method**: `UpdateActionService.findByDirectCalculation(baseAmount, expectedTaxAmount, taxBreakdowns, context)`

**Process**:

1. **For Each Breakdown**:
   - Gets `tax_rate_details.percentage_decimal`
   - Calculates tax rate: `parseFloat(percentage_decimal) / 100`
   - Calculates expected tax: `Math.round(baseAmount * taxRate)`

2. **Match Check**:
   - Compares calculated tax with expected tax
   - If difference <= 1 cent: Returns breakdown
   - Uses tolerance of 1 cent for rounding differences

3. **Return**:
   - Returns matching breakdown or `null`

#### Step 9: Find Tax Breakdown by Exact Amount

**Method**: `UpdateActionService.findByExactAmount(expectedAmount, shippingBreakdowns, generalBreakdowns)`

**Process**:

1. **Search in Shipping Breakdowns**:
   - Finds breakdown where `breakdown.amount === expectedAmount`

2. **Search in General Breakdowns**:
   - If not found, searches in general breakdowns

3. **Return**:
   - Returns matching breakdown or `null`

## Implementation Details

### Shipping Key Mapping Strategies

**Priority Order**:

1. **Line Item Metadata** (Highest Priority):
   - Extracts `shippingKey` from `lineItemData.metadata.shippingKey`
   - Most reliable as it comes directly from Stripe response
   - All line items in a calculation share the same shippingKey

2. **Request Mapping**:
   - Uses `requests[i].shippingKey` to map to `calculations[i]`
   - Reliable when requests are provided

3. **ShippingInfoGroups Index** (Fallback):
   - Maps by array index: `shippingInfoGroups[i].shippingKey`
   - Less reliable, used only when metadata/requests unavailable
   - Logs warning about potential inaccuracy

### Duplicate Handling Rules

**When Duplicates Occur**:
- Same `lineItemId` + `shippingKey` combination appears in multiple calculations
- Can happen when line items are split across multiple ship-from groups or shipping methods

**Combination Logic**:
1. **Combine Tax Amounts**:
   ```javascript
   combinedTaxAmount = existing.centAmount + new.centAmount
   ```

2. **Calculate Effective Rate**:
   ```javascript
   effectiveRate = combinedTaxAmount / totalBaseAmount
   ```
   - Uses base amounts for precise calculation
   - If base amount is 0, averages rates: `(existingRate + newRate) / 2`

3. **Update Action**:
   - Updates existing action with combined amounts and effective rate
   - Removes temporary `_baseAmount` field before returning

### Tax Breakdown Matching Strategies

**For Line Items**:

1. **STRATEGY 1: Direct Calculation** (Highest Priority):
   - Calculates expected tax from base amount and tax rate
   - Matches if difference <= 1 cent
   - Most accurate matching

2. **STRATEGY 2: Most Common Tax Type** (Fallback):
   - Finds most frequently occurring tax type
   - Returns first breakdown with that type
   - Used when direct calculation fails

**For Shipping Costs**:

1. **STRATEGY 1: Shipping Tax Breakdown**:
   - Searches in `calculation.shipping_cost.tax_breakdown`
   - Uses direct calculation matching

2. **STRATEGY 2: General Tax Breakdown**:
   - Searches in `calculation.tax_breakdown`
   - Uses direct calculation matching

3. **STRATEGY 3: Exact Amount Match**:
   - Finds breakdown where `breakdown.amount === shippingTaxAmount`
   - Searches both shipping and general breakdowns

4. **STRATEGY 4: Create from Template**:
   - Calculates effective rate from amounts
   - Uses first available breakdown as template
   - Updates amount and percentage

### Single vs Multiple Shipping Mode

**Single Mode**:
- No shippingKey in line item actions
- Single shipping tax action (no shippingKey)
- Uses combined calculation for shipping

**Multiple Mode**:
- shippingKey required in line item actions
- One shipping tax action per shippingKey
- Maps calculations to shippingKeys
- Processes each shipping method separately

### Zero Tax Handling

**When Zero Tax is Created**:
- Shipping cost has no tax (`amount_tax <= 0`)
- No tax breakdown found after all strategies
- No calculation found for shippingKey

**Zero Tax Action Structure**:
```javascript
{
  action: "setShippingMethodTaxAmount",
  shippingKey: shippingKey, // Only in Multiple mode
  externalTaxAmount: {
    totalGross: {
      currencyCode: currency,
      centAmount: 0
    },
    taxRate: {
      name: 'no_shipping_tax',
      amount: 0,
      country: country
    }
  }
}
```

## Usage Example

### Complete Flow Example

```javascript
// 1. Tax Orchestrator executes calculations
const calculations = await executeTaxCalculations(requests);

// 2. Create update actions
const updateActions = updateActionService.createCartUpdateActionsFromMultipleCalculations(
  calculations,
  shippingInfoGroups,
  requests,
  cart
);

// 3. Return to commercetools API Extension
return {
  actions: updateActions
};
```

### Update Actions Structure

```javascript
[
  // Cart custom type action
  {
    action: "setCustomType",
    type: { key: "connector-stripe-tax-calculation-reference", typeId: "type" },
    fields: {
      connectorStripeTax_calculationReferences: ["calc_123", "calc_456"],
      connectorStripeTax_amountTotal: 10000,
      // ... other metadata fields
    }
  },
  
  // Line item tax actions
  {
    action: "setLineItemTaxAmount",
    lineItemId: "line-item-1",
    shippingKey: "shipping-key-1", // Only in Multiple mode
    externalTaxAmount: {
      totalGross: {
        currencyCode: "USD",
        centAmount: 800
      },
      taxRate: {
        name: "sales_tax",
        amount: 0.08,
        country: "US"
      }
    }
  },
  
  // Shipping tax action
  {
    action: "setShippingMethodTaxAmount",
    shippingKey: "shipping-key-1", // Only in Multiple mode
    externalTaxAmount: {
      totalGross: {
        currencyCode: "USD",
        centAmount: 100
      },
      taxRate: {
        name: "shipping_tax",
        amount: 0.08,
        country: "US"
      }
    }
  }
]
```

## Technical Notes

### Performance Considerations

- **Selective Combination**: Only combines calculations for metadata, preserving individual precision
- **Efficient Mapping**: Uses Maps for O(1) lookups when mapping shipping keys
- **Direct Processing**: Processes calculations individually to avoid precision loss
- **Duplicate Detection**: Uses Map-based grouping for efficient duplicate handling

### Edge Cases Handled

- **Missing Tax Breakdowns**: Uses multiple fallback strategies to find or create breakdowns
- **Zero Tax Shipping**: Creates zero-tax actions when shipping has no tax
- **Missing Shipping Keys**: Handles cases where shippingKey is not available
- **Duplicate Line Items**: Combines duplicates with accurate effective rate calculation
- **Empty Calculations**: Handles empty calculation arrays gracefully
- **Missing Metadata**: Falls back to index-based mapping when metadata unavailable
- **Multiple Currencies**: Aggregates currencies from all calculations

### Logging and Debugging

- **Action Creation Logging**: Logs count of actions created
- **Tax Breakdown Matching**: Logs when breakdowns are found with strategy used
- **Duplicate Combination**: Logs when duplicates are combined
- **Warning Logging**: Logs warnings for missing breakdowns or inaccurate mappings
- **Error Logging**: Comprehensive error logging with context

## Configuration Requirements

### commercetools Setup

1. **Cart Custom Type**:
   - Custom type must exist with key: `connector-stripe-tax-calculation-reference`
   - Required fields:
     - `connectorStripeTax_calculationReferences` (Array of Strings)
     - `connectorStripeTax_amountTotal` (Number)
     - `connectorStripeTax_taxAmountExclusive` (Number)
     - `connectorStripeTax_taxAmountInclusive` (Number)
     - `connectorStripeTax_currencies` (Array of Strings)
     - `connectorStripeTax_expiresAt` (Array of Strings)
     - `connectorStripeTax_calculationTimestamp` (String)

2. **Line Item Tax Actions**:
   - Requires `setLineItemTaxAmount` action support
   - In Multiple mode, requires `shippingKey` parameter support

3. **Shipping Tax Actions**:
   - Requires `setShippingMethodTaxAmount` action support
   - In Multiple mode, requires `shippingKey` parameter support

### Environment Variables

No environment variables are required for this functionality. The service uses the data provided by the orchestrator.

## Related Documentation

- `process-tax-behavior-determination.md`: Tax behavior determination process
- `process-category-taxcode-selection.md`: Tax code selection for products
- `process-ship-from-selection.md`: Ship-from address selection
- `process-shipping-taxcode-selection.md`: Shipping tax code selection
- `ship-from-tax-calculation-flow.md`: Complete tax calculation flow

## Summary

The process of update action creation is a comprehensive transformation system that:

1. **Combines calculations** selectively for cart metadata while preserving individual precision
2. **Creates cart custom type action** with combined metadata from all calculations
3. **Creates line item total price actions** to set base prices (REQUIRED for ExternalAmount mode)
4. **Maps calculations** to shipping keys using multiple strategies (metadata, requests, index)
5. **Creates line item tax actions** with proper shipping key association and duplicate handling
6. **Ensures coverage** by creating zero-tax actions for line items with total price but no tax
7. **Creates shipping actions** for each shipping method with accurate tax breakdown matching
8. **Creates cart total tax action** to set cart's total gross amount (REQUIRED for ExternalAmount mode)
9. **Finds tax breakdowns** using multiple fallback strategies when direct matching fails
10. **Handles edge cases** gracefully with zero-tax actions and fallback strategies
11. **Supports both modes** (Single and Multiple shipping modes) appropriately

This system ensures accurate, precise, and maintainable transformation of Stripe tax calculations into commercetools cart update actions, handling complex scenarios with multiple calculations, shipping methods, and tax breakdowns.

