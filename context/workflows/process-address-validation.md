# Process Address Validation

## Description

The process of address validation is a two-tier validation mechanism implemented in the address service. This system automatically validates addresses using local business rules and verifies them with Stripe's Tax API to ensure addresses are acceptable for tax calculations.

The process is designed to handle e-commerce scenarios where addresses must be validated before tax calculations can be performed. The solution uses a sequential validation approach: first validating address structure and local business rules, then verifying with Stripe that the address can be used for tax calculations. This ensures both format correctness and Stripe API acceptance.

**Main Flow**: The system first validates the address structure (Step 0), then performs local validation using country-specific rules (Step 1), and finally verifies the address with Stripe by creating a temporary tax calculation (Step 2). The result includes validation status, error details, user-friendly messages, and actionable guidance for address corrections.

## Problem

E-commerce platforms require accurate address validation for tax calculations:
- Addresses must meet country-specific format requirements (postal codes, state codes, required fields)
- Addresses must be accepted by Stripe Tax API for tax calculations
- Different countries have different address requirements (US requires state and postal code, while others may be more flexible)
- Users need clear, actionable feedback when addresses fail validation
- Stripe may reject addresses that pass local validation due to API-specific requirements

The main challenges addressed by this solution include:

1. **Country-Specific Validation**: Different countries have different address requirements (required fields, postal code formats, state code formats).

2. **Stripe API Verification**: Local validation may pass, but Stripe may reject the address for tax calculation purposes, requiring verification with Stripe's API.

3. **User-Friendly Error Messages**: Users need clear, actionable error messages that help them correct address issues.

4. **Actionable Guidance**: When validation fails, users need specific steps to fix the address.

5. **Error Code Mapping**: Stripe error codes must be mapped to user-friendly messages and actionable guidance.

6. **Performance Optimization**: Stripe verification requires API calls, so the system should only verify when local validation passes.

## Solution Found

The solution implements a sequential two-tier validation algorithm that:

1. **Validates address structure**: Checks that the address is a valid object with required basic fields (Step 0)
2. **Performs local validation**: Uses country-specific rules to validate address format, required fields, postal codes, and state codes (Step 1)
3. **Verifies with Stripe**: Creates a temporary Stripe tax calculation to verify the address is accepted by Stripe (Step 2)
4. **Provides user feedback**: Returns validation results with user-friendly messages, error codes, and actionable guidance
5. **Generates suggestions**: Creates field-specific suggestions for address corrections based on validation errors

### Key Features

- **Two-Tier Validation**: Local validation (fast, no API calls) followed by Stripe verification (API call only if local passes)
- **Country-Specific Rules**: Validates addresses based on country-specific requirements (US, CA, IN, and default rules)
- **Stripe API Integration**: Verifies addresses by creating temporary tax calculations with Stripe
- **User-Friendly Messages**: Maps technical error codes to user-friendly messages
- **Actionable Guidance**: Provides specific steps users can take to fix address issues
- **Error Code Mapping**: Maps Stripe error codes to actionable guidance and user messages
- **Suggestion Generation**: Generates field-specific suggestions with examples for postal codes and state codes
- **Comprehensive Logging**: Detailed audit trail for validation decisions and Stripe verification results

## Solution Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│              API Endpoint / Controller                           │
│         POST /taxCalculator/validateAddress                      │
│         Receives address object                                  │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│         addressService.validateAddress(address, requestId)      │
│         Address Service Entry Point                             │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 0: Validate Address Structure                             │
│  validateAddressStructure(address)                              │
│                                                                   │
│  - Check address is object (not array/null)                     │
│  - Check country exists                                         │
│  - Check country is string                                      │
└───────────────────────┬─────────────────────────────────────────┘
                        │
            ┌───────────┴───────────┐
            │                       │
            │ Valid?                │ Invalid
            │ Yes → Continue        │ Return early with errors
            │                       │
            ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 1: Local Validation                                       │
│  performLocalValidation(address)                                │
│                                                                   │
│  - Uses address.validator.js                                    │
│  - Country-specific rules (US, CA, IN, DEFAULT)                │
│  - Validates required fields                                    │
│  - Validates postal code format                                 │
│  - Validates state codes                                        │
│  - Validates field lengths                                      │
└───────────────────────┬─────────────────────────────────────────┘
                        │
            ┌───────────┴───────────┐
            │                       │
            │ Valid?                │ Invalid
            │ Yes → Continue        │ Skip Stripe verification
            │                       │
            ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 2: Stripe Verification                                   │
│  verifyAddressWithStripe(address, requestId)                   │
│                                                                   │
│  - Creates temporary Stripe tax calculation                    │
│  - Uses minimum amount (100 cents)                              │
│  - Uses tax code: txcd_99999999                                │
│  - Sets address_source: 'shipping'                              │
│  - If successful: address accepted                              │
│  - If error: maps error code to user message                    │
└───────────────────────┬─────────────────────────────────────────┘
                        │
            ┌───────────┴───────────┐
            │                       │
            │ Success?              │ Error
            │ Yes → accepted: true  │ Map error code
            │                       │ Get user message
            │                       │ Get actionable guidance
            │                       │
            ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 3: Build Validation Result                               │
│  buildValidationResult({address, localValidation,              │
│                        stripeVerification})                     │
│                                                                   │
│  - Determines overall success                                  │
│  - Combines local and Stripe results                           │
│  - Generates suggestions from errors                            │
│  - Returns complete validation result                           │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
                ┌───────────────┐
                │ Return Result │
                │ to Controller │
                └───────────────┘
```

## Step-by-Step Solution Description

### Overview Flow

1. **Structure Validation**: Validates that the address is a valid object with basic required fields (country)
2. **Local Validation**: Performs country-specific validation using local business rules
3. **Stripe Verification**: If local validation passes, verifies the address with Stripe by creating a temporary tax calculation
4. **Result Building**: Combines local and Stripe validation results into a comprehensive response
5. **Suggestion Generation**: Generates field-specific suggestions for address corrections

### Detailed Steps

#### Step 0: Validate Address Structure

**Method**: `AddressService.validateAddressStructure(address)`

**Process**:

1. **Object Validation**:
   - Checks if address is an object (not null, not array)
   - Returns error if address is invalid type

2. **Country Validation**:
   - Checks if `address.country` exists
   - Checks if `address.country` is a string
   - Returns errors if country is missing or invalid type

3. **Return**:
   - Returns array of structure errors (empty if valid)
   - Early return if structure is invalid (skips local and Stripe validation)

**Error Codes**:
- `INVALID_ADDRESS`: Address is not a valid object
- `MISSING_COUNTRY`: Country field is missing
- `INVALID_COUNTRY_TYPE`: Country is not a string

#### Step 1: Local Validation

**Method**: `AddressService.performLocalValidation(address)`

**Process**:

1. **Validator Call**:
   - Calls `validateAddress(address)` from `address.validator.js`
   - Returns array of validation errors

2. **Country-Specific Rules**:
   - **US**: Requires `line1`, `city`, `state`, `postal_code`, `country`
     - Postal code: `^\d{5}(-\d{4})?$` (e.g., `94105` or `94105-1234`)
     - State codes: Valid US state codes (AL, AK, AZ, etc.)
   - **CA**: Requires `country` only, optional `postal_code` and `state`
     - Postal code: `^[A-Z]\d[A-Z]\s?\d[A-Z]\d$` (e.g., `K1A 0B1`)
     - State codes: Valid Canadian province codes (AB, BC, MB, etc.)
   - **IN**: Requires `country`, either `postal_code` or `state`
     - Postal code: `^\d{6}$` (e.g., `110001`)
   - **DEFAULT**: Requires `country` only, optional `state` and `postal_code`

3. **Field Validation**:
   - Required fields: Checks each required field exists and is not empty
   - Either/or fields: For countries like India, checks at least one of the fields exists
   - Postal code format: Validates against country-specific regex
   - State codes: Validates against country-specific state code list
   - Field lengths: Validates `line1` (1-200 chars) and `city` (1-100 chars)

4. **Return**:
   - Returns object: `{ isValid: boolean, errors: Array }`
   - `isValid: true` if no errors, `false` otherwise

**Error Codes**:
- `MISSING_*`: Missing required field (e.g., `MISSING_LINE1`, `MISSING_CITY`)
- `INVALID_POSTAL_CODE`: Postal code format is invalid for country
- `INVALID_STATE`: State code is invalid for country
- `INVALID_LINE1`: Line1 length is invalid
- `INVALID_CITY`: City length is invalid

#### Step 2: Stripe Verification

**Method**: `AddressService.verifyAddressWithStripe(address, requestId)`

**Process**:

1. **Currency Selection**:
   - Gets currency for country using `getCurrencyForCountry(address.country)`
   - Falls back to `ADDRESS_VALIDATION_STRIPE_DEFAULT_CURRENCY` environment variable
   - Defaults to `'usd'` if no currency found

2. **Temporary Calculation Creation**:
   - Creates Stripe tax calculation with:
     ```javascript
     {
       currency: currency,
       customer_details: {
         address: {
           line1: address.line1,
           line2: address.line2,
           city: address.city,
           state: address.state,
           postal_code: address.postal_code,
           country: address.country,
         },
         address_source: 'shipping',
       },
       line_items: [
         {
           amount: 100, // Minimum amount for verification
           reference: 'address-verification',
           tax_code: 'txcd_99999999', // General tax code
         },
       ],
     }
     ```

3. **Success Handling**:
   - If calculation succeeds: Returns `{ accepted: true }`
   - Logs calculation ID for audit purposes

4. **Error Handling**:
   - Catches Stripe API errors
   - Maps error code to user-friendly message using `getUserFriendlyMessage()`
   - Gets actionable guidance using `getActionableGuidance()`
   - Returns:
     ```javascript
     {
       accepted: false,
       code: errorCode,
       userMessage: userFriendlyMessage,
       actionable: actionableGuidance // Optional, only if exists
     }
     ```

5. **Return**:
   - Returns verification result object
   - `accepted: true` if Stripe accepts the address
   - `accepted: false` with error details if Stripe rejects

**Stripe Error Codes Handled**:
- `customer_tax_location_invalid`: Address cannot be used for tax calculation
- `shipping_address_invalid`: Shipping address is invalid
- `invalid_tax_location`: Tax calculation not available for location
- `taxes_calculation_failed`: Unable to calculate taxes
- `stripe_tax_inactive`: Stripe Tax not activated in account

#### Step 3: Build Validation Result

**Method**: `AddressService.buildValidationResult({ address, localValidation, stripeVerification })`

**Process**:

1. **Overall Success Determination**:
   - Address is valid only if:
     - Local validation passes (`localValidation.isValid === true`) AND
     - Stripe verification is null (skipped) OR Stripe accepts (`stripeVerification.accepted === true`)

2. **Result Structure**:
   ```javascript
   {
     success: boolean,
     validation: {
       local: {
         isValid: boolean,
         errors: Array
       },
       stripe: {
         accepted: boolean,
         code: string,
         userMessage: string,
         actionable: Object // Optional
       } | null
     },
     address: {
       suggestions: Array
     }
   }
   ```

3. **Suggestion Generation**:
   - Calls `generateSuggestions(localValidation.errors, address)`
   - Generates field-specific suggestions based on errors
   - Includes examples for postal codes and state codes

4. **Return**:
   - Returns complete validation result object

#### Step 4: Generate Suggestions

**Method**: `AddressService.generateSuggestions(errors, address)`

**Process**:

1. **Error Iteration**:
   - Iterates through validation errors
   - Generates suggestions based on error codes

2. **Suggestion Types**:
   - **INVALID_POSTAL_CODE**:
     - Field: `postal_code`
     - Message: "Please check the postal code format for your country"
     - Example: Country-specific postal code example (e.g., `94105 or 94105-1234` for US)
   - **INVALID_STATE**:
     - Field: `state`
     - Message: "Please use a valid state/province code"
     - Example: Country-specific state code examples (e.g., `CA, NY, TX` for US)
   - **MISSING_***:
     - Field: Extracted from error code (e.g., `MISSING_LINE1` → `line1`)
     - Message: "The field '{field}' is required for {country}"
     - Required: `true`

3. **Return**:
   - Returns array of suggestion objects

**Suggestion Structure**:
```javascript
{
  field: 'postal_code',
  message: 'Please check the postal code format for your country',
  example: '94105 or 94105-1234'
}
```

#### Step 5: User-Friendly Message Mapping

**Method**: `AddressService.getUserFriendlyMessage(errorCode, defaultMessage)`

**Process**:

1. **Error Code Mapping**:
   - Maps Stripe error codes to user-friendly messages
   - Falls back to `defaultMessage` if no mapping exists
   - Falls back to generic message if no default provided

2. **Message Examples**:
   - `customer_tax_location_invalid`: "The address cannot be used for tax calculation. Please verify the address is correct."
   - `shipping_address_invalid`: "The shipping address is invalid. Please check and correct the address."
   - `invalid_tax_location`: "Tax calculation is not available for this location."
   - `taxes_calculation_failed`: "Unable to calculate taxes for this address."
   - `stripe_tax_inactive`: "Stripe Tax is not activated in your account."

3. **Return**:
   - Returns user-friendly message string

#### Step 6: Actionable Guidance

**Method**: `AddressService.getActionableGuidance(errorCode)`

**Process**:

1. **Guidance Mapping**:
   - Maps error codes to actionable guidance objects
   - Returns `null` if no guidance exists for error code

2. **Guidance Structure**:
   ```javascript
   {
     action: 'Description of action to take',
     steps: [
       'Step 1 description',
       'Step 2 description',
       'Step 3 description'
     ]
   }
   ```

3. **Guidance Examples**:
   - `customer_tax_location_invalid`:
     - Action: "Verify the address is complete and correct"
     - Steps: Check required fields, verify postal code format, ensure state code is valid
   - `shipping_address_invalid`:
     - Action: "Review and correct the shipping address"
     - Steps: Verify street address, check city and state, confirm postal code
   - `stripe_tax_inactive`:
     - Action: "Enable Stripe Tax in your Stripe Dashboard"
     - Steps: Go to dashboard, follow setup instructions, complete tax registration

4. **Return**:
   - Returns guidance object or `null`

## Implementation Details

### Country-Specific Validation Rules

**United States (US)**:
- Required fields: `line1`, `city`, `state`, `postal_code`, `country`
- Postal code format: `^\d{5}(-\d{4})?$` (5 digits, optional 4-digit extension)
- State codes: Valid US state codes (AL, AK, AZ, AR, CA, CO, etc.)
- Examples:
  - Postal code: `94105` or `94105-1234`
  - State: `CA`, `NY`, `TX`

**Canada (CA)**:
- Required fields: `country` only
- Optional fields: `postal_code`, `state`
- Postal code format: `^[A-Z]\d[A-Z]\s?\d[A-Z]\d$` (alphanumeric with optional space)
- State codes: Valid Canadian province codes (AB, BC, MB, NB, NL, NT, NS, NU, ON, PE, QC, SK, YT)
- Examples:
  - Postal code: `K1A 0B1` or `K1A0B1`
  - State: `ON`, `BC`, `QC`

**India (IN)**:
- Required fields: `country`
- Either/or required: `postal_code` OR `state` (at least one must be present)
- Postal code format: `^\d{6}$` (6 digits)
- Examples:
  - Postal code: `110001`
  - State: Optional if postal code provided

**Default (Other Countries)**:
- Required fields: `country` only
- Optional fields: `state`, `postal_code`
- No format validation for postal codes or state codes

### Currency Mapping

The system maps countries to default currencies for Stripe verification:

**Country-Currency Map**:
- US → `usd`
- CA → `cad`
- GB → `gbp`
- AU → `aud`
- NZ → `nzd`
- Eurozone countries (IE, FR, DE, IT, ES, NL, BE, AT, PT, FI, GR, LU, MT, CY, SK, SI, EE, LV, LT) → `eur`

**Fallback Order**:
1. Country-specific currency from map
2. `ADDRESS_VALIDATION_STRIPE_DEFAULT_CURRENCY` environment variable
3. Default: `'usd'`

### Stripe Verification Strategy

**Temporary Calculation Approach**:
- Creates a minimal Stripe tax calculation to verify address acceptance
- Uses minimum amount (100 cents) to minimize cost
- Uses general tax code (`txcd_99999999`) for verification
- Sets `address_source: 'shipping'` to match typical use case
- Calculation is created but not used (verification only)

**Benefits**:
- Confirms Stripe accepts the address before actual tax calculations
- Provides early feedback on address issues
- Uses minimal API resources (small calculation)

**Limitations**:
- Requires Stripe API call (adds latency)
- Creates temporary calculation (minimal cost)
- Only verifies if local validation passes (optimization)

### Error Handling Strategy

**Error Flow**:
1. **Structure Errors**: Return early, skip local and Stripe validation
2. **Local Validation Errors**: Skip Stripe verification, return with local errors
3. **Stripe Verification Errors**: Map to user-friendly messages, include actionable guidance

**Error Recovery**:
- Structure errors: User must fix address structure
- Local validation errors: User must fix format/required fields
- Stripe errors: User must fix address or check Stripe configuration

**Non-Fatal Errors**:
- Stripe verification errors are logged but don't throw exceptions
- Service always returns validation result (never throws)
- Controller handles HTTP response based on result

### Suggestion Generation Logic

**Suggestion Types**:

1. **Format Suggestions**:
   - Generated for `INVALID_POSTAL_CODE` and `INVALID_STATE` errors
   - Includes country-specific examples
   - Helps users understand correct format

2. **Required Field Suggestions**:
   - Generated for `MISSING_*` errors
   - Indicates which field is required
   - Shows country-specific requirements

**Example Suggestions**:
```javascript
[
  {
    field: 'postal_code',
    message: 'Please check the postal code format for your country',
    example: '94105 or 94105-1234'
  },
  {
    field: 'state',
    message: 'Please use a valid state/province code',
    example: 'CA, NY, TX'
  },
  {
    field: 'line1',
    message: 'The field "line1" is required for US',
    required: true
  }
]
```

## Usage Example

### Complete Flow Example

```javascript
// 1. API Endpoint receives address validation request
const address = {
  line1: '123 Main St',
  city: 'San Francisco',
  state: 'CA',
  postal_code: '94105',
  country: 'US'
};

// 2. Call address service
const validationResult = await addressService.validateAddress(
  address,
  requestId
);

// 3. Result structure
{
  success: true,
  validation: {
    local: {
      isValid: true,
      errors: []
    },
    stripe: {
      accepted: true
    }
  },
  address: {
    suggestions: []
  }
}
```

### Validation Failure Example

```javascript
// Invalid address (missing state for US)
const address = {
  line1: '123 Main St',
  city: 'San Francisco',
  postal_code: '94105',
  country: 'US'
  // Missing: state
};

const validationResult = await addressService.validateAddress(address);

// Result structure
{
  success: false,
  validation: {
    local: {
      isValid: false,
      errors: [
        {
          code: 'MISSING_STATE',
          message: 'state is required for US tax calculation'
        }
      ]
    },
    stripe: null // Skipped because local validation failed
  },
  address: {
    suggestions: [
      {
        field: 'state',
        message: 'The field "state" is required for US',
        required: true
      }
    ]
  }
}
```

### Stripe Verification Failure Example

```javascript
// Address passes local validation but Stripe rejects it
const address = {
  line1: '123 Main St',
  city: 'San Francisco',
  state: 'CA',
  postal_code: '94105',
  country: 'US'
};

const validationResult = await addressService.validateAddress(address);

// Result structure (if Stripe rejects)
{
  success: false,
  validation: {
    local: {
      isValid: true,
      errors: []
    },
    stripe: {
      accepted: false,
      code: 'customer_tax_location_invalid',
      userMessage: 'The address cannot be used for tax calculation. Please verify the address is correct.',
      actionable: {
        action: 'Verify the address is complete and correct',
        steps: [
          'Check that all required fields are filled',
          'Verify postal code format matches country requirements',
          'Ensure state/province code is valid'
        ]
      }
    }
  },
  address: {
    suggestions: []
  }
}
```

## Technical Notes

### Performance Considerations

- **Early Returns**: Structure validation returns early if invalid, avoiding unnecessary processing
- **Conditional Stripe Verification**: Only verifies with Stripe if local validation passes, reducing API calls
- **Minimal Stripe Calculation**: Uses smallest possible calculation (100 cents) for verification
- **Efficient Error Mapping**: Error code mapping uses direct object lookup (O(1))
- **Suggestion Generation**: Only generates suggestions for errors that exist

### Edge Cases Handled

- **Null/Undefined Address**: Returns structure error immediately
- **Array Address**: Returns structure error (address must be object)
- **Missing Country**: Returns structure error (country is required)
- **Invalid Country Type**: Returns structure error (country must be string)
- **Unknown Countries**: Uses DEFAULT validation rules (country only required)
- **Missing Optional Fields**: Handled gracefully (only required fields validated)
- **Stripe API Failures**: Mapped to user-friendly messages, doesn't throw exceptions
- **Missing Error Mappings**: Falls back to default messages
- **Missing Actionable Guidance**: Only includes if guidance exists for error code

### Logging and Debugging

- **Request Logging**: Logs address validation requests with request ID
- **Structure Validation**: Logs structure errors for debugging
- **Local Validation**: Logs validation results and error counts
- **Stripe Verification**: Logs verification attempts and results
- **Stripe Errors**: Logs Stripe API errors with full context (code, type, message)
- **Result Logging**: Logs final validation result (success, has Stripe verification)
- **Audit Trail**: Request ID tracked throughout validation process

### API Integration Details

**Stripe Tax Calculations API**:
```
POST /v1/tax/calculations
```

**Request Structure**:
```javascript
{
  currency: 'usd',
  customer_details: {
    address: {
      line1: '...',
      line2: '...',
      city: '...',
      state: '...',
      postal_code: '...',
      country: '...'
    },
    address_source: 'shipping'
  },
  line_items: [
    {
      amount: 100,
      reference: 'address-verification',
      tax_code: 'txcd_99999999'
    }
  ]
}
```

**Response Structure (Success)**:
```javascript
{
  id: 'calc_...',
  // ... calculation details
}
```

**Error Response Structure**:
```javascript
{
  error: {
    code: 'customer_tax_location_invalid',
    type: 'invalid_request_error',
    message: '...'
  }
}
```

## Configuration Requirements

### Environment Variables

1. **STRIPE_API_TOKEN** (required):
   - Stripe API key for tax calculations
   - Used to initialize Stripe client
   - Format: `sk_test_...` or `sk_live_...`

2. **ADDRESS_VALIDATION_STRIPE_DEFAULT_CURRENCY** (optional):
   - Default currency for Stripe verification when country currency not found
   - Default: `'usd'`
   - Format: Lowercase currency code (e.g., `'usd'`, `'eur'`, `'gbp'`)

### Address Validator Configuration

The address validator (`address.validator.js`) contains country-specific rules:

1. **Country Requirements**:
   - Defined in `COUNTRY_ADDRESS_REQUIREMENTS` object
   - Can be extended with new countries
   - Each country has:
     - `required`: Array of required field names
     - `optional`: Array of optional field names (if applicable)
     - `either_required`: Array of fields where at least one is required (if applicable)
     - `postal_code_regex`: Regular expression for postal code validation
     - `state_codes`: Array of valid state/province codes

2. **Adding New Countries**:
   ```javascript
   COUNTRY_ADDRESS_REQUIREMENTS.NEW_COUNTRY = {
     required: ['country', 'city'],
     postal_code_regex: /^...$/,
     state_codes: ['CODE1', 'CODE2']
   };
   ```

### Stripe Configuration

1. **Stripe Tax Activation**:
   - Stripe Tax must be activated in Stripe Dashboard
   - Required for address verification to work
   - Error `stripe_tax_inactive` returned if not activated

2. **Tax Code Configuration**:
   - Uses general tax code `txcd_99999999` for verification
   - This tax code should be available in Stripe account

## Related Documentation

- `process-tax-orchestration.md`: Complete tax calculation flow that uses addresses
- `process-ship-from-selection.md`: Ship-from address resolution process
- Address validator: `tax-calculator/src/validators/address.validator.js`
- Address controller: `tax-calculator/src/controllers/address.validation.controller.js`

## Summary

The process of address validation is a robust two-tier system that:

1. **Validates address structure** to ensure basic requirements are met
2. **Performs local validation** using country-specific rules for format and required fields
3. **Verifies with Stripe** by creating temporary tax calculations to confirm API acceptance
4. **Provides user feedback** with user-friendly messages and actionable guidance
5. **Generates suggestions** for address corrections based on validation errors
6. **Handles errors gracefully** with comprehensive error mapping and fallback messages
7. **Optimizes performance** by only verifying with Stripe when local validation passes

This system ensures efficient, accurate, and user-friendly address validation for tax calculations in e-commerce platforms. The two-tier approach provides fast local validation while ensuring Stripe API compatibility, and the comprehensive error handling and suggestion generation help users correct address issues quickly and effectively.

