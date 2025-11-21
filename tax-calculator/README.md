# Tax Calculator
This module provides an application based on [commercetools Connect](https://docs.commercetools.com/connect), which will be triggered by the [extension](https://docs.commercetools.com/tutorials/extensions) from commercetools project once there is a cart created/updated. The corresponding cart details are then synchronized to the external tax provider to calculate tax amount.

The module also provides scripts for post-deployment and pre-undeployment action. After deployment via connect service completed, [commercetools Extension](https://docs.commercetools.com/tutorials/extensions) is created by post-deployment script which listen to any cart create/update action in commercetools Project. Once cart has been created/updated, the commercetools Extension triggers an API of tax calculator module to handle the corresponding changes.

## Get started
#### Change the key of commercetools Subscription
Please specify your desired key for creation of commercetools Extension [here](https://github.com/commercetools/connect-tax-integration-template/blob/dbdce163f08b36d8635d7705dd58c89d03bf8399/tax-calculator/src/connectors/constants.js#L2C50-L2C75).
The default key is 'ctpTaxCalculatorExtension'.

#### Install your tax-provider SDK 
Please run following npm command under order-syncer folder to install the NodeJS SDK provided by tax provider.

```bash
$ npm install <tax-provider-sdk>
```
#### Install dependencies
```bash
$ npm install
```
#### Run unit test
```bash
$ npm run test:unit
```
#### Run integration test
```bash
$ npm run test:integration
```
#### Run the application in local environment
```bash
$ npm run start
```
#### Run post-deploy script in local environment
```bash
$ npm run connector:post-deploy
```
#### Run pre-undeploy script in local environment
```bash
$ npm run connector:pre-undeploy
```

## Development in local environment
Different from staging and production environments, in which the out-of-the-box setup and variables have been set by connect service during deployment, the tax-calculator requires additional operations in local environment for development.
#### Create Commercetools Extension in your Commercetools Project
When a service-type connector application is deployed via connect service, a Commercetools Extension is created automatically. However, it does not apply on local environment. To develop the tax-calculator in local environment, you need to follow the steps below:
1. Create a Commercetools Extension.
2. Use HTTP tunnel tools like [ngrok](https://ngrok.com/docs/getting-started) to expose your local development server to internet.
3. Set the URL provided by the tunnel tool as the destination in Extension, so that event can be triggered to the tax-calculator in your local environment.

For details, please refer [here](https://docs.commercetools.com/tutorials/extensions).

#### Set the required environment variables

Before starting the development, we advise users to create a .env file in order to help them in local development.
      
Refer [here](https://github.com/commercetools/connect-tax-integration-template/tree/fix-documentation#deployment-configuration) for more details about the environment variables required for tax-calculator application to run.

## Tax Behavior Configuration

The tax calculator supports configurable tax behavior to ensure accurate tax display and calculation based on regional practices, product types, and merchant preferences.

### Overview

Tax behavior determines how tax is calculated and displayed to customers, which is critical for providing accurate pricing expectations and compliance with regional tax display requirements.

### Tax Behavior Options

#### 1. Inclusive
- Tax is already included in the listed price
- Customer pays: List Price (which includes tax)
- Common in Europe, Australia, many other regions
- Often required by law for B2C transactions

#### 2. Exclusive
- Tax is added on top of the listed price
- Customer pays: List Price + Tax
- Common in North America (US, Canada)
- Preferred for B2B transactions

#### 3. Stripe Default
- If no behavior is determined, Stripe will use its own default behavior
- Stripe's automatic behavior varies by currency and region

### Configuration Levels

The tax behavior is determined using the following priority order:

1. **Country Mapping** - If `COUNTRY_TAX_BEHAVIOR_MAPPING` is configured and the shipping country matches a country in the mapping, that behavior is used
2. **Merchant Default** - Falls back to `TAX_BEHAVIOR_DEFAULT` value (if configured)
3. **Stripe Default** - If no behavior is determined, Stripe will use its own default behavior

### Environment Variables

#### TAX_BEHAVIOR_DEFAULT
Sets the default tax behavior for all tax calculations when no other rules apply.

**Valid values:**
- `inclusive` - Tax is included in the displayed price
- `exclusive` - Tax is added on top of the displayed price

**Example:**
```bash
TAX_BEHAVIOR_DEFAULT=exclusive
```

> **_NOTE:_** If this environment variable isn't set, then the post-deploy script of the connector will attempt to fetch a default setting from some PSP Tax Providers, such as Stripe. See [Stripe Tax Behavior Settings](https://docs.stripe.com/tax/products-prices-tax-codes-tax-behavior#tax-behavior)

#### COUNTRY_TAX_BEHAVIOR_MAPPING
JSON object mapping country codes to their default tax behavior. This allows different tax behaviors for different markets.

**Optional:** If not provided, the system will skip country-based behavior determination and proceed to merchant default.

**Format:**
```json
{
  "US": "exclusive",
  "CA": "exclusive", 
  "DE": "inclusive",
  "FR": "inclusive",
  "AU": "inclusive",
  "GB": "inclusive"
}
```

**Example:**
```bash
COUNTRY_TAX_BEHAVIOR_MAPPING='{"US":"exclusive","DE":"inclusive","FR":"inclusive"}'
```

## Available Endpoints

The tax calculator module provides the following REST API endpoints:

### POST /taxCalculator
Main endpoint for tax calculation. Triggered automatically by commercetools API Extension when a cart is created or updated.

**Request:**
- Triggered by commercetools API Extension
- Receives cart object in request body (frozen state, ExternalAmount tax mode)

**Response:**
- Returns commercetools update actions for applying calculated taxes to the cart
- Status: `202 Accepted` on success
- Status: `400 Bad Request` on validation errors
- Status: `500 Internal Server Error` on system errors

**Example Response:**
```json
{
  "actions": [
    {
      "action": "setCustomType",
      "type": { "key": "stripe-tax", "typeId": "type" },
      "fields": { ... }
    },
    {
      "action": "setLineItemTaxAmount",
      "lineItemId": "line-item-id",
      "externalTaxAmount": { ... }
    }
  ]
}
```

### POST /validateAddress
Endpoint for address validation. Validates shipping addresses using local business rules and Stripe Tax API verification.

**Request Body:**
```json
{
  "address": {
    "line1": "123 Main St",
    "city": "San Francisco",
    "state": "CA",
    "postal_code": "94105",
    "country": "US"
  }
}
```

**Response:**
```json
{
  "success": true,
  "validation": {
    "local": {
      "isValid": true,
      "errors": []
    },
    "stripe": {
      "accepted": true
    }
  },
  "address": {
    "suggestions": []
  }
}
```

**Rate Limiting:**
- Configurable via `ADDRESS_VALIDATION_RATE_LIMIT` (default: 100 requests/minute)
- Time window configurable via `ADDRESS_VALIDATION_WINDOW_MINUTES` (default: 1 minute)

**Status Codes:**
- `200 OK`: Validation completed (check `success` field for result)
- `429 Too Many Requests`: Rate limit exceeded
- `400 Bad Request`: Invalid request format

## Services Overview

The tax calculator module is built using a service-oriented architecture with the following core services:

### Tax Orchestrator Service
**Purpose**: Main orchestration service that coordinates the complete tax calculation flow.

**Responsibilities:**
- Coordinates all other services in the correct sequence
- Determines tax behavior for the cart
- Retrieves product categories
- Groups line items by ship-from address
- Creates Stripe tax calculation requests
- Executes calculations in parallel (for multiple shipping methods)
- Transforms results into commercetools update actions

**Key Methods:**
- `orchestrateTaxCalculation(cart)` - Main orchestration method

### Tax Behavior Service
**Purpose**: Determines whether taxes should be calculated as inclusive or exclusive.

**Responsibilities:**
- Determines tax behavior at cart level (applied to all line items)
- Implements priority-based fallback logic:
  1. Country-specific mapping (highest priority)
  2. Merchant-wide default
  3. Stripe default (lowest priority)
- Caches configuration to optimize performance

**Key Methods:**
- `determineTaxBehaviorForCart(cartRequest)` - Determines behavior for all line items
- `determineCartTaxBehavior(cartContext)` - Determines behavior for cart

### Category Service
**Purpose**: Retrieves product categories from commercetools API with intelligent caching.

**Responsibilities:**
- Fetches expanded categories with custom types from commercetools
- Implements in-memory caching (5-minute TTL)
- Supports partial cache hits (only fetches missing products)
- Handles large product sets through batch processing (>500 products)
- Executes batches concurrently for optimal performance

**Key Methods:**
- `getCategoriesForProducts(productIds, options)` - Retrieves categories for multiple products

### Tax Code Service
**Purpose**: Resolves Stripe tax codes for products based on category configuration.

**Responsibilities:**
- Checks category custom type fields for tax codes
- Supports custom type-based tax code assignment
- Caches shipping method data to avoid repeated API calls
- Throws clear errors when tax codes are not found

**Key Methods:**
- `getTaxCodeForProduct(cartLineItem, productCategories)` - Resolves tax code for a product
- `getShippingTaxCodeFromShippingInfo(shippingInfo)` - Resolves tax code for shipping

### Ship-From Service
**Purpose**: Resolves ship-from addresses for line items using multiple fallback strategies.

**Responsibilities:**
- Resolves ship-from addresses from line item supply channels
- Falls back to inventory entry supply channels (dropshipping)
- Uses default business address as final fallback
- Groups line items by ship-from address for separate tax calculations
- Caches channel data to optimize performance

**Key Methods:**
- `resolveAllShipFromAddresses(lineItems)` - Resolves addresses for all line items
- `resolveShipFromForLineItem(lineItem)` - Resolves address for a single line item

### Address Service
**Purpose**: Validates shipping addresses using two-tier validation (local + Stripe).

**Responsibilities:**
- Validates address structure and format
- Performs country-specific validation (postal codes, state codes, required fields)
- Verifies addresses with Stripe Tax API
- Generates user-friendly error messages and suggestions
- Provides actionable guidance for address corrections

**Key Methods:**
- `validateAddress(address, requestId)` - Main validation method

### Update Action Service
**Purpose**: Transforms Stripe tax calculation results into commercetools update actions.

**Responsibilities:**
- Combines multiple calculations (for multiple shipping methods)
- Creates cart custom type update actions
- Creates line item tax update actions
- Creates shipping tax update actions
- Creates cart total tax action (for ExternalAmount mode)
- Handles shipping key separation for multiple shipping modes

**Key Methods:**
- `createCartUpdateActionsFromMultipleCalculations(calculations, shippingInfoGroups, requests, cart)` - Main transformation method

### Tax Error Handler Service
**Purpose**: Handles tax calculation errors and converts them to commercetools-compatible format.

**Responsibilities:**
- Handles tax code not found errors
- Handles ship-from not found errors
- Handles Stripe API errors
- Maps Stripe error codes to user-friendly messages
- Returns commercetools-compatible error format

**Key Methods:**
- `handleTaxCalculationError(error, request, response, cartRequestBody)` - Main error handler

## Environment Variables

The tax calculator module supports the following environment variables. All variables listed in `connect.yaml` are available for configuration:

### Required Variables

#### commercetools Configuration
- **CTP_PROJECT_KEY**: commercetools project key
- **CTP_CLIENT_ID**: commercetools API client ID
- **CTP_CLIENT_SECRET**: commercetools API client secret
- **CTP_SCOPE**: commercetools API client scope
- **CTP_REGION**: commercetools project region

#### Stripe Tax Configuration
- **TAX_PROVIDER_API_TOKEN**: Stripe API secret key for Stripe Tax

### Optional Variables

#### Tax Behavior Configuration
- **TAX_BEHAVIOR_DEFAULT**: Default tax behavior (`inclusive` or `exclusive`)
- **COUNTRY_TAX_BEHAVIOR_MAPPING**: JSON string mapping countries to tax behaviors

#### Tax Code Configuration
- **TAX_CODE_MAPPING_JSON**: JSON string mapping commercetools categories to Stripe tax codes

#### Ship-From Address Configuration
- **SHIP_FROM_REQUIRED**: Require ship-from address (`true` or `false`, default: `false`)
- **DEFAULT_BUSINESS_COUNTRY**: Default business country
- **DEFAULT_BUSINESS_STATE**: Default business state/province
- **DEFAULT_BUSINESS_CITY**: Default business city
- **DEFAULT_BUSINESS_POSTAL_CODE**: Default business postal code
- **DEFAULT_BUSINESS_LINE1**: Default business street address line 1
- **DEFAULT_BUSINESS_LINE2**: Default business street address line 2
- **CHANNEL_PRIORITY**: Comma-separated channel IDs for priority-based selection

#### Address Validation Configuration
- **ADDRESS_VALIDATION_RATE_LIMIT**: Rate limit for address validation (requests per minute, default: `100`)
- **ADDRESS_VALIDATION_WINDOW_MINUTES**: Time window for rate limit (minutes, default: `1`)
- **ADDRESS_VALIDATION_STRIPE_DEFAULT_CURRENCY**: Default currency for Stripe verification (default: `usd`)

For complete configuration details, see [connect.yaml](../connect.yaml) in the root directory.