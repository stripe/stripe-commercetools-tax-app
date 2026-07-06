# Architecture — tax-calculator

## Overview

`tax-calculator` is a JavaScript (ESM) Express service that receives commercetools cart data via a commercetools API Extension, calls Stripe Tax to calculate taxes per line item / shipping method / ship-from group, and returns commercetools cart update actions. It also exposes an address-validation endpoint that probes Stripe Tax with a test calculation. It is a standalone deployable service (no relative imports to or from the sibling `order-syncer` module).

## Entry Points

| Trigger | Detail | File | Auth |
| --- | --- | --- | --- |
| HTTP POST | `/taxCalculator/` — tax calculation; expects `body.resource.obj` (a CT cart). Triggered by the CT API Extension on cart Create/Update. | `src/routes/tax.calculator.route.js:7` → `src/controllers/tax.calculator.controller.js:12` | none (no request-auth middleware) |
| HTTP POST | `/taxCalculator/validateAddress` — address validation; expects `body.address`. | `src/routes/address.validation.route.js:6` → `src/controllers/address.validation.controller.js:14` | none |
| CLI | `node src/connectors/post-deploy.js` — validates Stripe Tax, creates custom types + CT API extension. | `src/connectors/post-deploy.js:87` | — |
| CLI | `node src/connectors/pre-undeploy.js` — deletes CT API extension + custom types. | `src/connectors/pre-undeploy.js:35` | — |

**CT API Extension trigger predicate:** the extension registered by `post-deploy` points at `CONNECT_SERVICE_URL` and fires on carts where `taxMode="ExternalAmount"` with a 2000ms timeout (`src/connectors/action.js:31-34`). Any cart not in `ExternalAmount` tax mode never reaches this service.

## Directory Map

```
tax-calculator/
  src/
    index.js                         HTTP bootstrap; listens on hardcoded port 8080 (src/index.js:10)
    routes/
      tax.calculator.route.js        POST /taxCalculator/ (:7)
      address.validation.route.js    POST /taxCalculator/validateAddress (:6)
    controllers/
      tax.calculator.controller.js   Tax-calc request handler (:12)
      address.validation.controller.js  Address-validation request handler (:14)
    services/
      tax-orchestrator.service.js    Orchestrates category→ship-from→tax-code→parallel Stripe calls→update actions
      category.service.js            Resolves product categories from CT (batched, cached)
      ship-from.service.js           Resolves ship-from address (channel→inventory→default), cached
      tax-code.service.js            Resolves Stripe tax code per product (category custom-type field only), cached
      tax-behavior.service.js        Resolves tax_behavior (default/country mapping), cached
      address.service.js             Address validation via a $1.00 Stripe test calculation
      update-action.service.js       Builds CT cart update actions from Stripe results
    connectors/
      post-deploy.js                 Deploy hook: Stripe validation, custom types, CT extension
      pre-undeploy.js                Undeploy hook: delete extension + custom types
      action.js                      CT extension + custom-type create/delete helpers
      customTypes.js                 Custom-type definitions + field names
    validators/
      stripeTaxValidator.js          Post-deploy Stripe Tax settings validation
      address.validator.js           US/CA/IN state + postal-code rules
      env-var.validators.js          Env-var presence/shape validation
      helpers.validators.js          Allowed CT region list, etc.
    config/
      taxCodeMapping.config.js       Loads TAX_CODE_CATEGORY_MAPPING_JSON (validated at deploy, unused at runtime)
    errors/                          Typed error classes (TaxCodeNotFoundError, TaxCodeShippingNotFoundError, ...)
    middlewares/
      auth.middleware.js             Builds CT client-credentials context for CT calls
      error.middleware.js            Error handler (defined but never registered — dead)
    clients/
      build.client.js                CT SDK client construction
    utils/
      config.util.js                 readConfiguration — reads + validates env vars
  resources/                         Static resources
  test/                              Unit + integration tests
```

## External Dependencies

| Service | Operation | File | Error Handling |
| --- | --- | --- | --- |
| Stripe Tax API | `tax.calculations.create` (one per ship-from/shipping-method request, in parallel) | `src/services/tax-orchestrator.service.js:546` | `Promise.allSettled`; failed calculations logged as `warn` and dropped; throws only if ALL fail. Partial failures are silently excluded from the result. |
| Stripe Tax API | `tax.calculations.create` (address verification) | `src/services/address.service.js:148` | try/catch; error caught and converted to `{ accepted: false }` — not re-thrown. |
| Stripe Tax API | `tax.settings.retrieve` (post-deploy validation) | `src/validators/stripeTaxValidator.js:19` | try/catch; re-thrown wrapped as "Stripe Tax validation failed". |
| CT Platform API | `productProjections().get` (categories, expanded) | `src/services/category.service.js:145` | try/catch; single query re-throws; batch mode uses `allSettled` — failed batches logged as error and skipped (swallowed). |
| CT Platform API | `channels().withId().get` (ship-from address) | `src/services/ship-from.service.js:96` | try/catch; error logged `warn`, returns null (swallowed). |
| CT Platform API | `inventory().get` (ship-from via inventory) | `src/services/ship-from.service.js:125` | try/catch; error logged `warn`, returns null (swallowed). |
| CT Platform API | `shippingMethods().withId().get` (shipping tax code) | `src/services/tax-code.service.js:289` | try/catch; logged error, re-thrown. |
| CT Platform API | `extensions().get/.post/.withKey().delete` | `src/connectors/action.js:37-56,77-115` | `createCTPExtension` wraps and re-throws; `fetchExtensionByKey` returns null on 404. |
| CT Platform API | `categories().get` (post-deploy mapping validation) | `src/connectors/action.js:201` | try/catch; re-thrown. |
| CT Platform API | `types().get/.post/.withKey().delete` (custom types) | `src/connectors/action.js:310-331,394-433` | create path re-throws; delete path catches per-type, logs error, continues (swallowed). |
| CT Auth API | client-credentials token flow (implicit, on every CT call) | `src/middlewares/auth.middleware.js:6`; `src/clients/build.client.js:13` | none explicit (SDK-managed). |

## Key Configuration

### commercetools credentials

| Key | Required | Default | File |
| --- | --- | --- | --- |
| `CTP_CLIENT_ID` | yes (exactly 24 chars) | — | `src/utils/config.util.js:14` |
| `CTP_CLIENT_SECRET` | yes (exactly 32 chars) | — | `src/utils/config.util.js:15` |
| `CTP_PROJECT_KEY` | yes (validated key) | — | `src/utils/config.util.js:16` |
| `CTP_SCOPE` | no | `'default'` (applied in `auth.middleware.js:15`) | `src/utils/config.util.js:17` |
| `CTP_REGION` | yes (validated against allowed region list) | — | `src/utils/config.util.js:18` |
| `CONNECT_SERVICE_URL` | yes for post-deploy (read via `properties.get`) | — | `src/connectors/post-deploy.js:23` |

### Stripe

| Key | Required | Default | File |
| --- | --- | --- | --- |
| `STRIPE_API_TOKEN` | yes in practice (not enforced by env validator) | — | `src/utils/config.util.js:19`; also read directly at `src/services/address.service.js:5` |
| `ADDRESS_VALIDATION_STRIPE_DEFAULT_CURRENCY` | no | `'usd'` | `src/services/address.service.js:138` |

### Tax behavior / tax code

| Key | Required | Default | File |
| --- | --- | --- | --- |
| `TAX_CODE_CATEGORY_MAPPING_JSON` | no | `{ categories: [] }` | `src/utils/config.util.js:20`; `src/config/taxCodeMapping.config.js:24` |
| `TAX_BEHAVIOR_DEFAULT` | no (validated inclusive/exclusive) | — (may be auto-set from Stripe in post-deploy) | `src/utils/config.util.js:21`; `src/validators/stripeTaxValidator.js:73` |
| `TAX_BEHAVIOR_COUNTRY_MAPPING` | no (validated JSON object) | `{}` | `src/utils/config.util.js:22` |
| `TAX_CODE_DEFAULT` | no | auto-set from Stripe settings if absent | `src/validators/stripeTaxValidator.js:79` |

> `TAX_CODE_CATEGORY_MAPPING_JSON` is validated at post-deploy and loaded by `taxCodeMapping.config.js`, but is never consulted at runtime — see `context/known-issues.md` Issue 1.

### Ship-from

| Key | Required | Default | File |
| --- | --- | --- | --- |
| `SHIP_FROM_REQUIRED` | no | falsey | `src/services/ship-from.service.js:57,71`; `src/services/tax-orchestrator.service.js:193` |
| `SHIP_FROM_CHANNEL_PRIORITY` | no | `[]` | `src/services/ship-from.service.js:216` |
| `SHIP_FROM_DEFAULT_BUSINESS_COUNTRY` | no | `'US'` | `src/services/ship-from.service.js:231` |
| `SHIP_FROM_DEFAULT_BUSINESS_STATE` | no | `'NY'` | `src/services/ship-from.service.js:232` |
| `SHIP_FROM_DEFAULT_BUSINESS_CITY` | no | `'New York'` | `src/services/ship-from.service.js:233` |
| `SHIP_FROM_DEFAULT_BUSINESS_POSTAL_CODE` | no | `'10001'` | `src/services/ship-from.service.js:234` |
| `SHIP_FROM_DEFAULT_BUSINESS_LINE1` | no | `''` | `src/services/ship-from.service.js:235` |
| `SHIP_FROM_DEFAULT_BUSINESS_LINE2` | no | `''` | `src/services/ship-from.service.js:236` |

### Custom type keys

| Key | Required | Default | File |
| --- | --- | --- | --- |
| `CUSTOM_TYPE_PRODUCT_KEY` | no | `'connector-stripe-tax-product'` | `src/connectors/customTypes.js:26` |
| `CUSTOM_TYPE_CATEGORY_KEY` | no | `'connector-stripe-tax-category'` | `src/connectors/customTypes.js:54` |
| `CUSTOM_TYPE_SHIPPING_KEY` | no | `'connector-stripe-tax-shipping'` | `src/connectors/customTypes.js:82` |
| `CUSTOM_TYPE_CART_KEY` | no | `'connector-stripe-tax-calculation-reference'` | `src/connectors/customTypes.js:110` |

### Notable hardcoded values (not configurable)

| Value | Meaning | File |
| --- | --- | --- |
| `8080` | HTTP listen port | `src/index.js:10` |
| `'txcd_99999999'` | default tax code for the address-verification Stripe call | `src/services/address.service.js:165` |
| `100` | amount (cents) for the address-verification calculation | `src/services/address.service.js:163` |
| `'exclusive'` | `tax_behavior` forced on shipping cost | `src/services/tax-orchestrator.service.js:277,397` |
| `'shipping'` | `address_source` sent to Stripe | `src/services/tax-orchestrator.service.js:232,345`; `address.service.js:159` |
| `5*60*1000` | cache TTL (ms) across category/ship-from/tax-code/tax-behavior services | `category.service.js:24`; `ship-from.service.js:15`; `tax-code.service.js:19`; `tax-behavior.service.js:11` |
| `500` / `5` | product query batch size / max concurrent category batches | `category.service.js:124,138,171,172` |
| `10` | max parent-category traversal depth | `tax-code.service.js:113,222` |
| `'US'` / `'USD'` | fallback country / currency codes | `update-action.service.js:397,649,914,1210` / `:180,534,681,906,1159` |
| `2000` | CT API Extension `timeoutInMs` | `src/connectors/action.js:34` |
