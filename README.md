# Commercetools Stripe Tax Connector

This repository provides a production-ready [commercetools Connect](https://docs.commercetools.com/connect) connector that integrates **commercetools Composable Commerce** with **Stripe Tax** for automated sales tax calculation and transaction reporting.

The connector enables real-time tax calculation during checkout and synchronizes completed orders to Stripe for tax compliance and reporting. It uses [Cart](https://docs.commercetools.com/api/projects/carts) and [Order](https://docs.commercetools.com/api/projects/orders) data models from commercetools, [API Extensions](https://docs.commercetools.com/api/projects/api-extensions) for real-time tax calculation, and asynchronous [Subscriptions](https://docs.commercetools.com/api/projects/subscriptions) for order synchronization.

## Key Features

### Tax Calculator Module
- **Real-time Tax Calculation**: Automatic tax calculation when carts are created/updated via API Extensions
- **Address Validation**: Two-tier validation (local rules + Stripe verification) for shipping addresses
- **Tax Code Resolution**: Automatic tax code determination from product categories with custom type support
- **Ship-From Address Resolution**: Multi-strategy resolution (supply channels, inventory, default business address)
- **Tax Behavior Configuration**: Configurable inclusive/exclusive tax behavior by country or merchant default
- **Multiple Shipping Support**: Handles both Single and Multiple shipping modes with parallel tax calculations
- **Category Caching**: In-memory cache for product categories (5-minute TTL) to optimize performance
- **Batch Processing**: Efficient handling of large product catalogs (>500 products) with concurrent batch execution
- **Error Handling**: Comprehensive error handling with commercetools-compatible error formats

### Order Syncer Module
- **Order Synchronization**: Automatic synchronization of completed orders to Stripe Tax Transactions
- **Transaction Reporting**: Creates tax transactions in Stripe for compliance and reporting
- **Event-Driven Architecture**: Uses Google Cloud Pub/Sub for reliable order processing

## Technologies Used

### Core Technologies
- **Node.js**: JavaScript runtime environment
- **Express.js**: Web server framework for REST API endpoints
- **JavaScript (ES6+)**: Modern JavaScript with ES modules

### SDKs and Libraries
- **[commercetools SDK](https://docs.commercetools.com/sdk/js-sdk-getting-started)**: Official commercetools SDK for API communication
- **[Stripe Node.js SDK](https://github.com/stripe/stripe-node)**: Official Stripe SDK for Stripe Tax API integration
- **dotenv**: Environment variable management
- **lodash**: Utility library for data manipulation

### Testing
- **[Jest](https://jestjs.io/)**: JavaScript testing framework for unit and integration tests
- **[supertest](https://github.com/ladjs/supertest#readme)**: HTTP assertion library for API testing
- **[sinon](https://sinonjs.org/)**: Standalone test spies, stubs and mocks

### Development Tools
- **Babel**: JavaScript compiler for ES6+ support
- **ESLint**: Code linting and quality checks
- **npm**: Package manager and script runner

### Infrastructure & Services
- **commercetools Composable Commerce**: E-commerce platform
- **Stripe Tax**: Automated tax calculation and reporting service
- **Google Cloud Pub/Sub**: Event messaging for order synchronization
- **commercetools Connect**: Connector deployment platform

## Prerequisite
#### 1. commercetools composable commerce API client
Users are expected to create API client responsible for API extension creation as well as fetching cart and order details from composable commerce project, API client should have enough scope to be able to do so. These API client details are taken as input as an environment variable/ configuration for connect. Details of composable commerce project can be provided as environment variables (configuration for connect) `CTP_PROJECT_KEY` , `CTP_CLIENT_ID`, `CTP_CLIENT_SECRET`, `CTP_SCOPE`, `CTP_REGION`. For details, please read [Deployment Configuration](./README.md#deployment-configuration).

#### 2. Stripe Tax Account
Users are expected to have a Stripe account with Stripe Tax enabled. The Stripe API token is required for tax calculations and order synchronization. API token can be provided as environment variable (configuration for connect) `TAX_PROVIDER_API_TOKEN`. For details, please read [Deployment Configuration](./README.md#deployment-configuration).

**Stripe Tax Setup Requirements:**
- Stripe Tax must be activated in your Stripe Dashboard
- Head office address must be configured in Stripe Tax settings
- Tax registration must be completed for the countries where you sell
 
## Getting Started

The connector contains two separate modules:

### Tax Calculator
Provides a REST API to calculate tax amounts through Stripe Tax by processing cart details. It is triggered automatically by commercetools API Extension when a cart (in frozen state with tax mode as ExternalAmount) is created or updated.

**Key Capabilities:**
- Real-time tax calculation during checkout
- Address validation with Stripe verification
- Tax code resolution from product categories
- Ship-from address resolution
- Support for multiple shipping methods
- Configurable tax behavior (inclusive/exclusive)

For detailed documentation, see [Tax Calculator README](tax-calculator/README.md)

### Order Syncer
Receives messages from commercetools project when orders are created. The order and cart details are synchronized to Stripe Tax as transactions for accounting, compliance, and tax reporting purposes.

**Key Capabilities:**
- Automatic order synchronization via Google Cloud Pub/Sub
- Stripe Tax Transaction creation
- Transaction reference linking for reporting

For detailed documentation, see [Order Syncer README](order-syncer/README.md)

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    commercetools Platform                        │
├─────────────────────────────────────────────────────────────────┤
│  Cart Creation/Update  │         Order Created                  │
│  (ExternalAmount mode) │         (OrderCreated event)           │
└──────────┬─────────────┴──────────────────┬─────────────────────┘
           │                                │
           │ (1) API Extension Trigger      │ (4) Pub/Sub Message
           │                                │
           ▼                                ▼
┌─────────────────────┐          ┌─────────────────────┐
│  Tax Calculator     │          │   Order Syncer      │
│  (Service)          │          │   (Event Handler)   │
│                     │          │                     │
│  - Tax Calculation  │          │  - Order Sync       │
│  - Address Validation│         │  - Transaction Create│
│  - Tax Code Resolve │          │                     │
└──────────┬──────────┘          └──────────┬──────────┘
           │                                │
           │ (2) Stripe Tax API             │ (5) Stripe Tax API
           │                                │
           ▼                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Stripe Tax Platform                         │
│  - Tax Calculations  │  - Tax Transactions                      │
│  - Address Validation│  - Tax Reporting                        │
└─────────────────────────────────────────────────────────────────┘
```

## Register as Connector

Follow guidelines [here](https://docs.commercetools.com/connect/getting-started) to register the connector for public/private use in commercetools Connect.

## Deployment Configuration
In order to deploy your customized connector application on commercetools Connect, it needs to be published. For details, please refer to [documentation about commercetools Connect](https://docs.commercetools.com/connect/concepts)
In addition, in order to support connect, the tax integration connector template has a folder structure as listed below
```
├── tax-calculator
│   ├── src
│   ├── test
│   └── package.json
├── order-syncer
│   ├── src
│   ├── test
│   └── package.json
└── connect.yaml
```

Connect deployment configuration is specified in `connect.yaml` which is required information needed for publishing of the application. Following is the deployment configuration used by tax calculator and order syncer modules
```
deployAs:
  - name: tax-calculator
    applicationType: service
    endpoint: /taxCalculator
    scripts:
      postDeploy: npm install && npm run connector:post-deploy
      preUndeploy: npm install && npm run connector:pre-undeploy
    configuration:
      standardConfiguration:
        - key: CTP_REGION
          description: region of commercetools composable commerce project
      securedConfiguration:
        - key: CTP_PROJECT_KEY
          description: commercetools composable commerce project key
        - key: CTP_CLIENT_ID
          description: commercetools composable commerce client ID
        - key: CTP_CLIENT_SECRET
          description: commercetools composable commerce client secret
        - key: CTP_SCOPE
          description: commercetools composable commerce client scope
        - key: TAX_PROVIDER_API_TOKEN
          description: API Token for communication between the connector and tax provider
  - name: order-syncer
    applicationType: event
    endpoint: /orderSyncer
    scripts:
      postDeploy: npm install && npm run connector:post-deploy
      preUndeploy: npm install && npm run connector:pre-undeploy
    configuration:
      standardConfiguration:
        - key: CTP_REGION
          description: region of commercetools composable commerce project
      securedConfiguration:
        - key: CTP_PROJECT_KEY
          description: commercetools project key
        - key: CTP_CLIENT_ID
          description: commercetools client ID
        - key: CTP_CLIENT_SECRET
          description: commercetools client secreet
        - key: CTP_SCOPE
          description: commercetools client scope
        - key: TAX_PROVIDER_API_TOKEN
          description: API Token for communication between the connector and tax provider
```

### Environment Variables Reference

#### commercetools Configuration (Required)
- **CTP_PROJECT_KEY**: The key of your commercetools composable commerce project
- **CTP_CLIENT_ID**: The client ID of your commercetools API client
- **CTP_CLIENT_SECRET**: The client secret of your commercetools API client
- **CTP_SCOPE**: The scope constrains the endpoints and read/write access rights
- **CTP_REGION**: The region of your commercetools project (e.g., `us-central1`, `europe-west1`)

#### Stripe Tax Configuration (Required)
- **TAX_PROVIDER_API_TOKEN**: Stripe API token (secret key) for Stripe Tax API access

#### Tax Calculator - Tax Behavior Configuration (Optional)
- **TAX_BEHAVIOR_DEFAULT**: Default tax behavior for all calculations (`inclusive` or `exclusive`)
- **COUNTRY_TAX_BEHAVIOR_MAPPING**: JSON string mapping country codes to tax behaviors (e.g., `'{"US":"exclusive","DE":"inclusive"}'`)

#### Tax Calculator - Tax Code Configuration (Optional)
- **TAX_CODE_MAPPING_JSON**: JSON string mapping commercetools categories to Stripe tax codes

#### Tax Calculator - Ship-From Configuration (Optional)
- **SHIP_FROM_REQUIRED**: Whether to require ship-from address (`true` or `false`, default: `false`)
- **DEFAULT_BUSINESS_COUNTRY**: Default country for ship-from address
- **DEFAULT_BUSINESS_STATE**: Default state/province for ship-from address
- **DEFAULT_BUSINESS_CITY**: Default city for ship-from address
- **DEFAULT_BUSINESS_POSTAL_CODE**: Default postal code for ship-from address
- **DEFAULT_BUSINESS_LINE1**: Default street address line 1
- **DEFAULT_BUSINESS_LINE2**: Default street address line 2
- **CHANNEL_PRIORITY**: Comma-separated channel IDs for priority-based ship-from selection

#### Tax Calculator - Address Validation Configuration (Optional)
- **ADDRESS_VALIDATION_RATE_LIMIT**: Rate limit for address validation (requests per minute, default: 100)
- **ADDRESS_VALIDATION_WINDOW_MINUTES**: Time window for rate limit (minutes, default: 1)
- **ADDRESS_VALIDATION_STRIPE_DEFAULT_CURRENCY**: Default currency for Stripe address verification (default: `usd`)

For detailed configuration documentation, see:
- [Tax Calculator Configuration](tax-calculator/README.md#tax-behavior-configuration)
- [Deployment Configuration](connect.yaml)

## Additional Resources

### Documentation
- [Tax Calculator Documentation](tax-calculator/README.md) - Complete guide for tax calculator module
- [Order Syncer Documentation](order-syncer/README.md) - Complete guide for order syncer module

### Testing
We have provided comprehensive unit and integration test cases with [Jest](https://jestjs.io/) and [supertest](https://github.com/ladjs/supertest#readme). The implementation is under `test` folder in both `tax-calculator` and `order-syncer` modules. It is recommended to implement additional test cases based on your specific needs.

### Support
For issues, questions, or contributions, please refer to the project repository or contact the development team. 