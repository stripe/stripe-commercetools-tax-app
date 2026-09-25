# Process Shipping Tax Code Selection

## Description

The process of shipping tax code selection is a direct resolution mechanism implemented in the tax-code service. This system automatically determines the appropriate Stripe tax code for shipping methods by retrieving the shipping method from commercetools API and checking its custom fields for a configured tax code.

The process is designed to handle shipping tax code configuration where shipping methods can have tax codes assigned directly through custom fields. Unlike product tax codes, shipping tax codes use a single-strategy approach: the tax code is retrieved directly from the shipping method's custom fields after fetching the complete shipping method object from commercetools API.

**Main Flow**: The system receives shipping information from the cart (either from `cart.shippingInfo` for Single mode or `cart.shipping[].shippingInfo` for Multiple mode), extracts the shipping method ID, fetches the complete shipping method object from commercetools API (including custom fields), and retrieves the tax code from the custom field `connectorStripeTax_TaxCode`. If no tax code is configured, the system returns `null`, allowing the orchestrator to handle the absence of shipping tax code appropriately.

## Problem

E-commerce platforms like commercetools handle shipping costs that need tax codes for accurate tax calculations:
- Shipping methods need tax codes assigned for proper tax calculation
- Shipping method custom fields are not automatically expanded in cart objects
- Different shipping methods may have different tax codes
- The system must fetch shipping methods from API to access custom fields
- Shipping tax codes are optional and may not be configured for all shipping methods

The main challenges addressed by this solution include:

1. **Custom Field Access**: Shipping method custom fields are not included in cart objects by default, requiring API calls to retrieve the complete shipping method object.

2. **Single Strategy Requirement**: Unlike products, shipping methods have a single source of truth for tax codes (custom fields), requiring a straightforward resolution approach.

3. **API Integration**: The system must efficiently fetch shipping methods from commercetools API without excessive calls or processing time.

4. **Optional Tax Codes**: Shipping tax codes are optional, and the system must handle cases where no tax code is configured gracefully.

5. **Multiple Shipping Modes**: The system must work with both Single and Multiple shipping modes, where shipping methods are accessed differently.

6. **Error Handling**: The system must handle API errors gracefully without breaking the tax calculation flow.

## Solution Found

The solution implements a direct API-based resolution algorithm that:

1. **Extracts shipping method ID**: Gets the shipping method ID from shipping info (Single or Multiple mode)
2. **Fetches shipping method from API**: Uses commercetools Shipping Method API to retrieve the complete shipping method object with custom fields
3. **Checks custom fields**: Examines the shipping method's custom fields for the tax code field `connectorStripeTax_TaxCode`
4. **Returns tax code or null**: Returns the tax code if found, or `null` if not configured
5. **Handles errors gracefully**: Catches API errors and throws them appropriately for the orchestrator to handle

### Key Features

- **Direct API Resolution**: Fetches shipping method from commercetools API to access custom fields
- **Single Strategy Approach**: Simple, straightforward resolution without fallback strategies
- **Custom Field Integration**: Direct integration with commercetools shipping method custom type fields
- **Optional Tax Code Support**: Returns `null` when tax code is not configured, allowing orchestrator to handle appropriately
- **Multiple Shipping Mode Support**: Works with both Single and Multiple shipping modes
- **Comprehensive Error Handling**: Proper error handling for API failures
- **Clear Return Values**: Returns tax code string or `null` for easy integration

## Solution Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│              Tax Orchestrator Service                            │
│         orchestrateTaxCalculation(cart)                          │
└───────────────────────┬─────────────────────────────────────────┘
                        │
        ┌───────────────┴───────────────┐
        │                               │
        │  Single Mode                  │  Multiple Mode
        │  cart.shippingInfo            │  cart.shipping[]
        │                               │
        ▼                               ▼
┌───────────────────────┐   ┌───────────────────────┐
│  shippingInfo         │   │  shipping[0]          │
│  .shippingMethod.id   │   │  .shippingInfo        │
│                       │   │  .shippingMethod.id   │
└───────────┬───────────┘   └───────────┬───────────┘
            │                           │
            └───────────┬───────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│  getShippingTaxCodeFromShippingInfo(shippingInfo)               │
│  Tax Code Service Entry Point                                   │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 1: Extract Shipping Method ID                           │
│  shippingInfo.shippingMethod.id                                 │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 2: Fetch Shipping Method from commercetools API         │
│  getShippingMethodById(shippingMethodId)                       │
│                                                                 │
│  GET /{projectKey}/shipping-methods/{ID}                       │
│  - Retrieves complete shipping method object                  │
│  - Includes custom fields                                     │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 3: Check Custom Fields                                  │
│  shippingMethod.custom.fields[TAX_CODE_CUSTOM_TYPE_NAME]      │
│                                                                 │
│  Field: connectorStripeTax_TaxCode                            │
└───────────────────────┬─────────────────────────────────────────┘
                        │
            ┌───────────┴───────────┐
            │                       │
            │ Found?                │ Not Found
            │ Yes → RETURN          │ Return null
            │                       │
            ▼                       ▼
    ┌───────────────┐      ┌───────────────┐
    │ Return tax    │      │ Return null  │
    │ code string   │      │              │
    └───────────────┘      └───────────────┘
```

## Step-by-Step Solution Description

### Overview Flow

1. **Entry Point**: The Tax Orchestrator Service calls `getShippingTaxCodeFromShippingInfo(shippingInfo)` with shipping information from the cart
2. **Extract Shipping Method ID**: The system extracts the shipping method ID from `shippingInfo.shippingMethod.id`
3. **Fetch Shipping Method**: Calls `getShippingMethodById()` to retrieve the complete shipping method object from commercetools API
4. **Check Custom Fields**: Examines `shippingMethod.custom.fields.connectorStripeTax_TaxCode` for the tax code
5. **Return Result**: Returns the tax code string if found, or `null` if not configured

### Detailed Steps

#### Step 1: Entry Point - Get Shipping Tax Code from Shipping Info

**Method**: `TaxCodeService.getShippingTaxCodeFromShippingInfo(shippingInfo)`

**Parameters**:
- `shippingInfo`: Shipping info object from cart (Single or Multiple mode)
  - Single mode: `cart.shippingInfo`
  - Multiple mode: `cart.shipping[].shippingInfo`

**Process**:

1. **Extract Shipping Method ID**:
   - Accesses `shippingInfo.shippingMethod.id`
   - This ID is used to fetch the complete shipping method object

2. **Fetch Shipping Method**:
   - Calls `getShippingMethodById(shippingInfo.shippingMethod.id)`
   - This method retrieves the complete shipping method from commercetools API

3. **Check Custom Fields**:
   - Accesses `shippingMethod?.custom?.fields?.[TAX_CODE_CUSTOM_TYPE_NAME]`
   - Field name: `connectorStripeTax_TaxCode`
   - Uses optional chaining to safely access nested properties

4. **Return Result**:
   - If tax code found: Returns the tax code string (e.g., `"txcd_99999999"`)
   - If not found: Returns `null`

**Code Example**:
```javascript
const shippingInfo = cart.shippingInfo; // Single mode
// or
const shippingInfo = cart.shipping[0].shippingInfo; // Multiple mode

const taxCode = await taxCodeService.getShippingTaxCodeFromShippingInfo(shippingInfo);
// Returns: "txcd_99999999" or null
```

#### Step 2: Fetch Shipping Method from commercetools API

**Method**: `TaxCodeService.getShippingMethodById(shippingMethodId)`

**Parameters**:
- `shippingMethodId`: Shipping method ID string

**Process**:

1. **API Query**:
   - Uses commercetools Shipping Method API:
     ```
     GET /{projectKey}/shipping-methods/{ID}
     ```
   - Fetches shipping method by ID
   - Returns complete shipping method object including custom fields

2. **Response Extraction**:
   - Extracts `response.body` which contains the shipping method object
   - The object includes:
     - `id`: Shipping method ID
     - `name`: Shipping method name
     - `custom`: Custom type object with fields
     - Other shipping method properties

3. **Error Handling**:
   - If API call fails:
     - Logs error with shipping method ID and error message
     - Throws error to be handled by caller
     - Prevents silent failures

4. **Return**:
   - Returns complete shipping method object with custom fields

**API Response Structure**:
```javascript
{
  id: "shipping-method-id",
  name: "Standard Shipping",
  custom: {
    type: {
      id: "custom-type-id",
      typeId: "type"
    },
    fields: {
      connectorStripeTax_TaxCode: "txcd_99999999"
    }
  },
  // ... other shipping method properties
}
```

#### Step 3: Check Custom Fields for Tax Code

**Process**:

1. **Custom Field Access**:
   - Accesses `shippingMethod.custom.fields.connectorStripeTax_TaxCode`
   - Uses optional chaining (`?.`) to safely access nested properties
   - Handles cases where:
     - `custom` is undefined
     - `fields` is undefined
     - `connectorStripeTax_TaxCode` is not set

2. **Tax Code Validation**:
   - Checks if tax code exists and is not empty
   - Tax code format: String (e.g., `"txcd_99999999"`)

3. **Return Decision**:
   - If tax code exists: Returns the tax code string
   - If not found: Returns `null`

**Custom Field Structure**:
```javascript
shippingMethod.custom.fields[TAX_CODE_CUSTOM_TYPE_NAME]
// Where TAX_CODE_CUSTOM_TYPE_NAME = 'connectorStripeTax_TaxCode'
```

## Implementation Details

### Custom Type Configuration

**Custom Field Name**: `connectorStripeTax_TaxCode`

**Structure in commercetools**:
```javascript
// Custom type definition
{
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
      name: 'connectorStripeTax_TaxCode',
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
}
```

**Code Access**:
```javascript
const taxCode = shippingMethod?.custom?.fields?.connectorStripeTax_TaxCode;
```

**Tax Code Format**: String in Stripe format (e.g., `"txcd_99999999"`)

### Single Strategy Approach

Unlike product tax codes which use multiple fallback strategies, shipping tax codes use a single, direct approach:

1. **No Fallback Strategies**: Shipping tax codes are retrieved only from shipping method custom fields
2. **Direct Resolution**: Single API call to fetch shipping method and check custom field
3. **Simple Logic**: No complex hierarchy traversal or multiple data sources
4. **Optional by Design**: Returns `null` when not configured, allowing orchestrator to handle appropriately

### API Integration Details

**commercetools Shipping Method API Endpoint**:
```
GET /{projectKey}/shipping-methods/{ID}
```

**Query Parameters**:
- `ID`: Shipping method ID (path parameter)

**Response Structure**:
```javascript
{
  id: "shipping-method-id",
  version: 1,
  name: "Standard Shipping",
  description: {...},
  custom: {
    type: {
      id: "custom-type-id",
      typeId: "type"
    },
    fields: {
      connectorStripeTax_TaxCode: "txcd_99999999"
    }
  },
  // ... other shipping method properties
}
```

**Why API Call is Required**:
- Cart objects in commercetools do not automatically expand shipping method custom fields
- The shipping method reference in cart only contains ID, not the full object
- Custom fields must be fetched separately via API call
- This ensures access to the complete shipping method configuration

### Error Handling

**Error Scenarios**:

1. **API Errors**:
   - Shipping method not found: API returns 404, error is logged and thrown
   - Network errors: Error is logged and thrown
   - Authentication errors: Error is logged and thrown
   - All API errors are propagated to caller for appropriate handling

2. **Missing Custom Fields**:
   - If shipping method has no custom type: Returns `null`
   - If custom type exists but field is not set: Returns `null`
   - Not treated as an error, handled gracefully

3. **Invalid Tax Code Format**:
   - System does not validate tax code format
   - Returns whatever value is stored in custom field
   - Validation should be done at configuration time

### Shipping Mode Support

**Single Shipping Mode**:
```javascript
// Cart structure
{
  shippingMode: "Single",
  shippingInfo: {
    shippingMethod: {
      id: "shipping-method-id"
    }
  }
}

// Usage
const taxCode = await taxCodeService.getShippingTaxCodeFromShippingInfo(
  cart.shippingInfo
);
```

**Multiple Shipping Mode**:
```javascript
// Cart structure
{
  shippingMode: "Multiple",
  shipping: [
    {
      shippingInfo: {
        shippingMethod: {
          id: "shipping-method-1"
        }
      }
    },
    {
      shippingInfo: {
        shippingMethod: {
          id: "shipping-method-2"
        }
      }
    }
  ]
}

// Usage - for each shipping method
for (const shipping of cart.shipping) {
  const taxCode = await taxCodeService.getShippingTaxCodeFromShippingInfo(
    shipping.shippingInfo
  );
}
```

## Usage Example

### Single Shipping Mode Example

```javascript
// 1. Get shipping info from cart
const shippingInfo = cart.shippingInfo;

// 2. Get shipping tax code
const taxCode = await taxCodeService.getShippingTaxCodeFromShippingInfo(
  shippingInfo
);

// 3. Use tax code in Stripe request
const stripeRequest = {
  line_items: [...],
  shipping_cost: {
    amount: shippingInfo.price.centAmount,
    currency: shippingInfo.price.currencyCode,
    tax_code: taxCode // "txcd_99999999" or null
  }
};
```

### Multiple Shipping Mode Example

```javascript
// 1. Get shipping methods from cart
const shippingMethods = cart.shipping;

// 2. Get tax code for each shipping method
for (const shipping of shippingMethods) {
  const taxCode = await taxCodeService.getShippingTaxCodeFromShippingInfo(
    shipping.shippingInfo
  );
  
  // 3. Create separate Stripe request for each shipping method
  const stripeRequest = {
    line_items: [...],
    shipping_cost: {
      amount: shipping.shippingInfo.price.centAmount,
      currency: shipping.shippingInfo.price.currencyCode,
      tax_code: taxCode // "txcd_99999999" or null
    }
  };
}
```

### Complete Integration Example

```javascript
// In tax orchestrator service
async buildShippingCost(cart, shippingInfo) {
  // Get shipping tax code
  const taxCode = await taxCodeService.getShippingTaxCodeFromShippingInfo(
    shippingInfo
  );
  
  // Build shipping cost object
  const shippingCost = {
    amount: shippingInfo.price.centAmount,
    currency: shippingInfo.price.currencyCode
  };
  
  // Add tax code if available
  if (taxCode) {
    shippingCost.tax_code = taxCode;
  }
  
  return shippingCost;
}
```

## Technical Notes

### Performance Considerations

- **Single API Call**: Only one API call per shipping method, no redundant queries
- **No Caching**: Shipping methods are fetched on-demand (could be optimized with caching if needed)
- **Direct Resolution**: No complex logic or multiple strategy checks
- **Efficient Access**: Uses optional chaining for safe property access

### Edge Cases Handled

- **Shipping method not found**: API error is thrown and handled by caller
- **Missing custom type**: Returns `null` gracefully
- **Missing custom field**: Returns `null` gracefully
- **Empty tax code**: Returns empty string (should be validated at configuration)
- **Invalid shipping info**: Handles undefined/null shipping info safely
- **API failures**: Errors are logged and thrown for proper error handling

### Logging and Debugging

- **API Error Logging**: Detailed error logging with shipping method ID and error message
- **No Success Logging**: Tax code retrieval is not logged (could be added for audit trail)
- **Error Context**: Error logs include shipping method ID for troubleshooting

### API Integration Details

**Why Custom Fields Are Not Expanded**:
- commercetools cart objects do not automatically expand shipping method custom fields
- Shipping method references in cart only contain ID and basic info
- Custom fields must be fetched via separate API call
- This is by design to keep cart objects lightweight

**API Call Optimization**:
- Currently, each shipping method requires a separate API call
- Could be optimized with batch fetching if multiple shipping methods are needed
- Caching could be implemented to reduce API calls for frequently used shipping methods

## Configuration Requirements

### commercetools Setup

1. **Custom Type for Shipping Methods**:
   - Create custom type with key: `connector-stripe-tax-shipping`
   - Add field: `connectorStripeTax_TaxCode` (String, optional)
   - Assign to resource type: `shipping-method`

2. **Shipping Method Configuration**:
   - For each shipping method that needs a tax code:
     - Assign the custom type to the shipping method
     - Set the `connectorStripeTax_TaxCode` field value
     - Format: `txcd_XXXXXXXX` (Stripe tax code format)

3. **Tax Code Assignment**:
   - Tax codes are optional - shipping methods can function without them
   - When tax code is not set, the system returns `null`
   - The orchestrator handles `null` tax codes appropriately

### Environment Variables

No environment variables are required for this functionality. The system uses the commercetools credentials configured in the API client.

## Related Documentation

- `process-category-taxcode-selection.md`: Product tax code selection process documentation
- `process-ship-from-selection.md`: Ship-from address selection process documentation
- `ship-from-tax-calculation-flow.md`: Complete tax calculation flow with shipping integration

## Summary

The process of shipping tax code selection is a straightforward system that:

1. **Extracts shipping method ID** from shipping info (Single or Multiple mode)
2. **Fetches shipping method** from commercetools API to access custom fields
3. **Checks custom fields** for the tax code field `connectorStripeTax_TaxCode`
4. **Returns tax code** if found, or `null` if not configured
5. **Handles errors** gracefully with proper error logging and propagation
6. **Supports both modes** (Single and Multiple shipping modes)
7. **Uses single strategy** approach without fallback mechanisms

This system ensures efficient, predictable, and maintainable shipping tax code resolution for accurate tax calculations in e-commerce platforms. The simplicity of the approach reflects the direct relationship between shipping methods and their tax codes, without the complexity of hierarchical resolution needed for products.

