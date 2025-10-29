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
