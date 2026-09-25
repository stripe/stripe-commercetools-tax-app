# Deployment — ct-stripe-tax

Prerequisites, configuration, and deploy/undeploy lifecycle for CT Connect. Source of truth: `connect.yaml`.

---

## Prerequisites

Complete these steps before deploying the connector. Skipping any will cause silent failures.

### Stripe account

- [ ] Stripe Tax enabled on the account — Dashboard → Tax → Settings
- [ ] Stripe API token (`rk_*****` restricted key or `sk_*****` secret key) with Stripe Tax read/write permissions
- [ ] Verify `validateStripeTax()` will pass: the token must be able to call `stripe.tax.calculations.create()`

### commercetools project

- [ ] API client with these scopes on `CTP_CLIENT_ID`:
  - `manage_extensions`
  - `manage_subscriptions`
  - `manage_types`
  - `manage_orders`
  - `view_orders`
  - `manage_payments`
  - `view_carts`
- [ ] Cart `taxMode` set to `ExternalAmount` on carts where Stripe Tax should apply
- [ ] GCP Pub/Sub topic pre-created and accessible via `CONNECT_GCP_TOPIC_NAME` + `CONNECT_GCP_PROJECT_ID` (injected by CT Connect)
- [ ] `TAX_CODE_CATEGORY_MAPPING_JSON` prepared — JSON string mapping CT category IDs to Stripe tax codes (e.g. `{"cat-id-1":"txcd_10000000"}`)

---

## Environment Variables

### Shared (both modules — `inheritAs` in connect.yaml)

#### Standard configuration

| Variable | Required | Notes |
|---|---|---|
| `CTP_PROJECT_KEY` | Yes | CT project key |
| `CTP_REGION` | Yes | e.g. `europe-west1.gcp` |

#### Secured configuration (encrypted by CT Connect)

| Variable | Required | Notes |
|---|---|---|
| `CTP_CLIENT_ID` | Yes | CT API client ID |
| `CTP_CLIENT_SECRET` | Yes | CT API client secret |
| `CTP_SCOPE` | Yes | CT scopes (space-separated) |
| `STRIPE_API_TOKEN` | Yes | Stripe API token (`sk_*****` or restricted key) |

### tax-calculator module

| Variable | Required | Default | Notes |
|---|---|---|---|
| `CUSTOM_TYPE_PRODUCT_KEY` | Yes | `connector-stripe-tax-product` | Custom type key for product/line item tax code |
| `CUSTOM_TYPE_CATEGORY_KEY` | Yes | `connector-stripe-tax-category` | Custom type key for category tax code |
| `CUSTOM_TYPE_SHIPPING_KEY` | Yes | `connector-stripe-tax-shipping` | Custom type key for shipping method tax code |
| `CUSTOM_TYPE_CART_KEY` | Yes | `connector-stripe-tax-calculation-reference` | Custom type key for cart tax calculation reference |
| `TAX_CODE_CATEGORY_MAPPING_JSON` | Yes | — | JSON mapping CT category IDs → Stripe tax codes. If omitted, connector installs with empty mapping (tax codes must come from product/category custom types) |
| `TAX_BEHAVIOR_DEFAULT` | No | `exclusive` | Default tax behavior: `exclusive` or `inclusive` |
| `TAX_BEHAVIOR_COUNTRY_MAPPING` | No | `{"US":"exclusive","CA":"exclusive","DE":"inclusive",...}` | JSON mapping country codes to tax behavior |
| `SHIP_FROM_REQUIRED` | No | `true` | Whether ship-from address is required. If `true` and unresolvable, calculation fails |
| `SHIP_FROM_DEFAULT_BUSINESS_COUNTRY` | No | — | Fallback country for ship-from |
| `SHIP_FROM_DEFAULT_BUSINESS_STATE` | No | — | Fallback state for ship-from |
| `SHIP_FROM_DEFAULT_BUSINESS_CITY` | No | — | Fallback city for ship-from |
| `SHIP_FROM_DEFAULT_BUSINESS_POSTAL_CODE` | No | — | Fallback postal code for ship-from |
| `SHIP_FROM_DEFAULT_BUSINESS_LINE1` | No | — | Fallback address line 1 for ship-from |
| `SHIP_FROM_DEFAULT_BUSINESS_LINE2` | No | — | Fallback address line 2 for ship-from |
| `SHIP_FROM_CHANNEL_PRIORITY` | No | — | Comma-separated channel IDs for priority-based ship-from selection (e.g. `channel-1,channel-2`) |
| `ADDRESS_VALIDATION_STRIPE_DEFAULT_CURRENCY` | No | `usd` | Currency used for Stripe address verification call |

### order-syncer module

| Variable | Required | Default | Notes |
|---|---|---|---|
| `CUSTOM_TYPE_ORDER_KEY` | Yes | `connector-stripe-tax-calculation-reference` | Custom type key for order tax transaction reference |
| `CONNECT_GCP_TOPIC_NAME` | — | — | Injected by CT Connect — do not set manually |
| `CONNECT_GCP_PROJECT_ID` | — | — | Injected by CT Connect — do not set manually |

---

## Deploy Lifecycle

### tax-calculator — Post-deploy (`npm run connector:post-deploy`)

Runs `tax-calculator/src/connectors/post-deploy.js`. Executed automatically by CT Connect after deployment.

**What it does (in order):**

1. **Validate Stripe Tax token** — calls `validateStripeTax(stripeApiToken)` which attempts a minimal Stripe Tax API call to confirm the token has Stripe Tax permissions. Fails hard if the token is invalid.
2. **Validate `TAX_CODE_CATEGORY_MAPPING_JSON`** — if provided, parses and calls `validateTaxCodeMapping(apiRoot, mapping)` to verify all referenced CT category IDs exist. Fails hard on invalid JSON or missing categories. If the env var is absent, logs a warning and continues.
3. **Create CT custom types** — calls `createCustomTypes(apiRoot)` to create or update all 4 custom types: `connector-stripe-tax-product`, `connector-stripe-tax-category`, `connector-stripe-tax-shipping`, `connector-stripe-tax-calculation-reference`.
4. **Register CT API Extension** — calls `createCTPExtension(apiRoot, key, url)`. If an extension with the same key already exists, it is deleted first, then recreated with the current `CONNECT_SERVICE_URL`. Extension timeout: 2000ms.

### tax-calculator — Pre-undeploy (`npm run connector:pre-undeploy`)

Runs `tax-calculator/src/connectors/pre-undeploy.js`.

**What it does:**

1. Deletes the CT API Extension (`ctpTaxCalculatorExtension`)
2. Deletes all 4 CT custom types (forced cleanup — `deleteCustomTypes(apiRoot, true)`)

### order-syncer — Post-deploy (`npm run connector:post-deploy`)

Runs `order-syncer/src/connectors/post-deploy.js`.

**What it does (in order):**

1. **Create Pub/Sub subscription** — calls `createChangedOrderSubscription(apiRoot, topicName, projectId, subscriptionKey)` to register a CT subscription on `OrderCreated` messages routed to the GCP Pub/Sub topic.
2. **Create CT custom type** — calls `createCustomTypes(apiRoot)` to create the `connector-stripe-tax-calculation-reference` custom type (with `connectorStripeTax_transactionReferences` field) on orders.

### order-syncer — Pre-undeploy (`npm run connector:pre-undeploy`)

Runs `order-syncer/src/connectors/pre-undeploy.js`.

**What it does:**

1. Deletes the CT Pub/Sub subscription (`deleteChangedOrderSubscription`)
2. Deletes the order custom type (forced cleanup)

---

## Deployed Applications

CT Connect deploys two applications from this connector (defined in `connect.yaml`):

| Name | Type | Trigger | Port | Description |
|---|---|---|---|---|
| `tax-calculator` | `service` | CT API Extension (synchronous) | 8080 | Real-time tax calculation on cart create/update |
| `order-syncer` | `event` | GCP Pub/Sub `OrderCreated` (asynchronous) | 8080 | Syncs completed order tax to Stripe Tax transactions |

---

## Validation After Deploy

1. CT Merchant Center → Extensions → confirm `ctpTaxCalculatorExtension` exists with the correct URL and `timeoutInMs: 2000`
2. CT Merchant Center → Subscriptions → confirm an `OrderCreated` subscription exists pointing to the order-syncer Pub/Sub topic
3. CT Merchant Center → Types → confirm all 4 custom types exist: `connector-stripe-tax-product`, `connector-stripe-tax-category`, `connector-stripe-tax-shipping`, `connector-stripe-tax-calculation-reference`
4. Add an item to a cart with `taxMode=ExternalAmount` — confirm the extension fires and `connectorStripeTax_calculationReferences` is set on the cart
5. Place a test order — confirm `connectorStripeTax_transactionReferences` is set on the order and Stripe Tax Dashboard shows a linked transaction
