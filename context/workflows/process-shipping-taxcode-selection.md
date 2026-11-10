# Process Shipping Tax Code Selection

**Trigger:** step 10 of `process-tax-orchestration.md`, and only when the shipping price is non-zero. Single
mode: `getShippingCostForGroup(cart)`, once per ship-from group
(`tax-calculator/src/services/tax-orchestrator.service.js:275`, `:481-492`). Multiple mode:
`fetchShippingCostsMap(cart)`, for every `cart.shipping` entry, once per ship-from group
(`tax-calculator/src/services/tax-orchestrator.service.js:304`, `:345-353`, `:499-510`).
**Modules involved:** tax-calculator — `tax-code.service.js`. Rule: `business-rules/tax-code-resolution.md` Rule 4, *Shipping tax code comes from the shipping method, not from line item categories*.
**Outcome:** the shipping method's `connectorStripeTax_TaxCode`, or `null`, placed in the request as
`shipping_cost.tax_code` next to the amount and the resolved tax behavior. A `null` is sent as it is.

## Happy Path

1. A missing or zero shipping price means no shipping cost and no lookup —
   `tax-calculator/src/services/tax-orchestrator.service.js:482-484`, `:500-502`
2. The shipping method id is read from `shippingInfo.shippingMethod.id` —
   `tax-calculator/src/services/tax-code.service.js:264`
3. The shipping method comes from a 5-minute per-instance cache, else from
   `GET /shipping-methods/{id}`, which is then cached — `tax-calculator/src/services/tax-code.service.js:279-304`
4. A truthy custom field value is returned, else `null` — `tax-calculator/src/services/tax-code.service.js:266-271`
5. It becomes `shipping_cost.tax_code` — `tax-calculator/src/services/tax-orchestrator.service.js:277-280`, `:416-419`

## Error Paths

| Condition | Behavior | File |
| --- | --- | --- |
| The fetch fails — 404, auth, network | logged and re-thrown; the cart update is answered with the SDK error's `statusCode`, else 500 | `tax-calculator/src/services/tax-code.service.js:305-311`; `tax-calculator/src/services/tax-error-handler.service.js:213-217` |
| No custom type, or the field is empty | `null` → the request carries `tax_code: null` | `tax-calculator/src/services/tax-code.service.js:266-271`; `tax-calculator/src/services/tax-orchestrator.service.js:277-280` |

## Notes

- **A shipping method's tax-code edit reaches calculations after up to 5 minutes**, per instance
  (`tax-calculator/src/services/tax-code.service.js:16-20`).

---

## Description

The process of shipping tax code selection is a direct resolution mechanism implemented in the tax-code service. This system automatically determines the appropriate Stripe tax code for shipping methods by retrieving the shipping method from commercetools API and checking its custom fields for a configured tax code.

The process handles shipping tax code configuration where shipping methods can have tax codes assigned directly through custom fields. Shipping tax codes use a single-strategy approach: the tax code is retrieved directly from the shipping method's custom fields after fetching the complete shipping method object from commercetools API.

**Main Flow**: The system receives shipping information from the cart (either from `cart.shippingInfo` for Single mode or `cart.shipping[].shippingInfo` for Multiple mode), extracts the shipping method ID, fetches the complete shipping method object from commercetools API (including custom fields), and retrieves the tax code from the custom field `connectorStripeTax_TaxCode`. If no tax code is configured, the system returns `null`, and the orchestrator copies it into the request unchanged as `shipping_cost.tax_code: null` (`tax-calculator/src/services/tax-orchestrator.service.js:277-280`, `:416-419`).

## Problem

E-commerce platforms like commercetools handle shipping costs that need tax codes for accurate tax calculations:
- Shipping methods need tax codes assigned for proper tax calculation
- Shipping method custom fields are not automatically expanded in cart objects
- Different shipping methods may have different tax codes
- The system must fetch shipping methods from API to access custom fields
- Shipping tax codes are optional and may not be configured for all shipping methods

The main challenges addressed by this solution include:

1. **Custom Field Access**: Shipping method custom fields are not included in cart objects by default, requiring API calls to retrieve the complete shipping method object.

2. **Single Strategy Requirement**: Shipping methods have a single source of truth for tax codes (custom fields), requiring a straightforward resolution approach.

3. **API Integration**: The system fetches shipping methods from commercetools API.

4. **Optional Tax Codes**: Shipping tax codes are optional, and the system handles cases where no tax code is configured.

5. **Multiple Shipping Modes**: The system works with both Single and Multiple shipping modes, where shipping methods are accessed differently.

6. **Error Handling**: The system handles API errors without breaking the tax calculation flow.

## Solution Found

The solution implements a direct API-based resolution algorithm that:

1. **Extracts shipping method ID**: Gets the shipping method ID from shipping info (Single or Multiple mode)
2. **Fetches shipping method from API**: Uses commercetools Shipping Method API to retrieve the complete shipping method object with custom fields
3. **Checks custom fields**: Examines the shipping method's custom fields for the tax code field `connectorStripeTax_TaxCode`
4. **Returns tax code or null**: Returns the tax code if found, or `null` if not configured
5. **Propagates errors**: Catches API errors and throws them to the orchestrator

### Key Features

- **Direct API Resolution**: Fetches shipping method from commercetools API to access custom fields
- **Single Strategy Approach**: Direct resolution without fallback strategies
- **Custom Field Integration**: Direct integration with commercetools shipping method custom type fields
- **Optional Tax Code Support**: Returns `null` when tax code is not configured
- **Multiple Shipping Mode Support**: Works with both Single and Multiple shipping modes
- **Clear Return Values**: Returns tax code string or `null`

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
│  shippingInfo         │   │  shipping[n]          │
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

In Multiple mode the lookup runs for every `cart.shipping` entry
(`tax-calculator/src/services/tax-orchestrator.service.js:345-353`).

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

2. **Tax Code Check**:
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

Shipping tax codes use a single, direct approach. The difference from product tax codes is the source of the code: categories for products, the shipping method for shipping.

1. **No Fallback Strategies**: Shipping tax codes are retrieved only from shipping method custom fields
2. **Direct Resolution**: Single API call to fetch shipping method and check custom field
3. **Simple Logic**: No complex hierarchy traversal or multiple data sources
4. **Optional by Design**: Returns `null` when not configured

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
   - All API errors are propagated to caller for handling

2. **Missing Custom Fields**:
   - If shipping method has no custom type: Returns `null`
   - If custom type exists but field is not set: Returns `null`

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

## Usage

```javascript
// Single mode
const taxCode = await taxCodeService.getShippingTaxCodeFromShippingInfo(
  cart.shippingInfo
);

// Multiple mode - for each shipping method
for (const shipping of cart.shipping) {
  const taxCode = await taxCodeService.getShippingTaxCodeFromShippingInfo(
    shipping.shippingInfo
  );
}
```

The orchestrator places the result as `shipping_cost.tax_code` in the request it sends:
`{ amount, tax_code }` (plus `tax_behavior` when resolved), with `tax_code` possibly `null`
(`tax-calculator/src/services/tax-orchestrator.service.js:275-289`, `:414-426`, `:481-510`).

## Technical Notes

### Performance Considerations

- **Single API Call**: Only one API call per shipping method
- **Caching**: shipping methods are cached in memory for 5 minutes per instance
  (`tax-calculator/src/services/tax-code.service.js:16-20`, `:279-304`)
- **Direct Resolution**: No complex logic or multiple strategy checks
- **Efficient Access**: Uses optional chaining for safe property access

### Edge Cases Handled

- **Shipping method not found**: API error is thrown and handled by caller
- **Missing custom type**: Returns `null`
- **Missing custom field**: Returns `null`
- **Empty tax code**: Returns `null` — an empty string is falsy
  (`tax-calculator/src/services/tax-code.service.js:267`)
- **API failures**: Errors are logged and thrown for handling by the caller

### Logging and Debugging

- **API Error Logging**: Detailed error logging with shipping method ID and error message
- **Error Context**: Error logs include shipping method ID for troubleshooting

### API Integration Details

**Why Custom Fields Are Not Expanded**:
- commercetools cart objects do not automatically expand shipping method custom fields
- Shipping method references in cart only contain ID and basic info
- Custom fields must be fetched via separate API call
- This keeps cart objects lightweight

**API Call Optimization**:
- Each shipping method requires a separate API call
- Could be optimized with batch fetching if multiple shipping methods are needed
- Shipping methods are cached for 5 minutes, per instance
  (`tax-calculator/src/services/tax-code.service.js:279-304`)

## Configuration Requirements

### commercetools Setup

1. **Custom Type for Shipping Methods**:
   - Create custom type with key: `connector-stripe-tax-shipping` (the default; overridable with
     `CUSTOM_TYPE_SHIPPING_KEY`. Post-deploy creates it — `process-deploy-and-undeploy.md`)
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
   - The orchestrator sends `null` tax codes to Stripe unchanged
     (`tax-calculator/src/services/tax-orchestrator.service.js:277-280`)

### Environment Variables

No environment variables are required for this functionality. The system uses the commercetools credentials configured in the API client.

## Related Documentation

- `process-category-taxcode-selection.md`: Product tax code selection process documentation
- `process-ship-from-selection.md`: Ship-from address selection process documentation
- `process-tax-orchestration.md`: Complete tax calculation flow with shipping integration

## Summary

The process of shipping tax code selection is a system that:

1. **Extracts shipping method ID** from shipping info (Single or Multiple mode)
2. **Fetches shipping method** from commercetools API to access custom fields
3. **Checks custom fields** for the tax code field `connectorStripeTax_TaxCode`
4. **Returns tax code** if found, or `null` if not configured
5. **Propagates errors** with error logging
6. **Supports both modes** (Single and Multiple shipping modes)
7. **Uses single strategy** approach without fallback mechanisms

This system provides predictable shipping tax code resolution for tax calculations, reflecting the direct relationship between shipping methods and their tax codes.
