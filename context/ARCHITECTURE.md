# Architecture — ct-stripe-tax

Two-module connector that integrates Stripe Tax with commercetools for real-time tax calculation and automated transaction reporting. Uses CT's native extensibility mechanisms: API Extension for synchronous calculation and Pub/Sub for asynchronous order sync.

## System Overview

```text
CT Cart (taxMode=ExternalAmount + lineItems present + state-change condition)
  └── API Extension trigger (synchronous, 2s timeout)
        └── tax-calculator (port 8080, route /taxCalculator)
              ├── Resolves tax codes from CT categories
              ├── Resolves ship-from addresses
              └── stripe.tax.calculations.create()
                    └── Returns update actions → CT applies to cart
                          (writes connectorStripeTax_calculationReferences and
                           other metadata fields to the order custom type)

CT Order Created
  └── Pub/Sub message (async)
        └── order-syncer (port 8080, route /orderSyncer)
              ├── Decodes message via decodeToJson() (base64 → JSON)
              ├── Reads connectorStripeTax_calculationReferences from order custom field
              ├── Single ref:  getTransactionFromTaxCalculation() (best-effort; tolerates resource_missing)
              ├── Multi ref:   createTaxTransactions() loops over all references calling tax.transactions.createFromCalculation()
              ├── Stores connectorStripeTax_transactionReferences on order via setCustomField
              └── Best-effort updatePaymentIntentMetadata() writes tax_transactions on the linked PI
```

## Two Modules

| Module | Trigger | Mode | Port | Endpoints |
| --- | --- | --- | --- | --- |
| `tax-calculator/` | CT API Extension on cart create/update | Synchronous | 8080 | `POST /taxCalculator` (success: HTTP 200 `{ actions }`); `POST /taxCalculator/validateAddress` (mounted on same path with `/validateAddress` sub-route) |
| `order-syncer/` | Google Cloud Pub/Sub on OrderCreated | Asynchronous | 8080 | `POST /orderSyncer` (success: 204 No Content; 202 for missing message data — note: incorrect, see `known-issues.md` Issue 18; 500 nack otherwise) |

### tax-calculator internals

| Layer | Path | Purpose |
| --- | --- | --- |
| Tax route | `src/routes/tax.calculator.route.js` | Mounted at `/taxCalculator`; forwards POST to `taxHandler` |
| Tax controller | `src/controllers/tax.calculator.controller.js` | `taxHandler` orchestrates services; returns HTTP 200 with `{ actions }` on success, HTTP 400 on missing cart |
| Address-validation route | `src/routes/address.validation.route.js` | Mounted at `/taxCalculator/validateAddress` |
| Address-validation controller | `src/controllers/address.validation.controller.js` | Calls `addressService.validateAddress`; creates a real Stripe Tax calculation for verification (phantom calculation — see `known-issues.md` Issue 3) |
| Orchestrator | `src/services/tax-orchestrator.service.js` | Coordinates all services; runs parallel Stripe calculations via `Promise.allSettled()` |
| Services | `src/services/` | `tax-behavior.service.js`, `category.service.js`, `ship-from.service.js`, `tax-code.service.js`, `update-action.service.js`, `address.service.js`, `tax-error-handler.service.js` |
| Custom types | `src/connectors/customTypes.js` | Cart-tax (on order), product, category, shipping custom type definitions |
| Connector | `src/connectors/action.js` | `createCTPExtension`, `validateTaxCodeMapping`, `createCustomTypes`, `deleteCTPExtension`, `deleteCustomTypes`, `validateCustomTypes` |
| Post-deploy | `src/connectors/post-deploy.js` | Validates Stripe Tax token → validates `TAX_CODE_CATEGORY_MAPPING_JSON` → creates custom types → registers API extension |
| Pre-undeploy | `src/connectors/pre-undeploy.js` | Calls `deleteCTPExtension` and `deleteCustomTypes(apiRoot, true)` |

### order-syncer internals

| Layer | Path | Purpose |
| --- | --- | --- |
| Route | `src/routes/sync.route.js` | Mounted at `/orderSyncer`; forwards POST to `syncHandler` |
| Controller | `src/controllers/sync.controller.js` | `syncHandler` + `syncOrderToTaxProvider` — decodes message, validates, fetches order, branches on single vs multiple calc refs, updates CT, writes PI metadata |
| Stripe client | `src/extensions/stripe/clients/client.js` | `getTransactionFromTaxCalculation()` (single ref; tolerates `resource_missing`; extracts existing tx ID from error message string — see `known-issues.md` Issue 19), `createTaxTransactions()` (loop over multi refs — no per-iteration try/catch, see `known-issues.md` Issue 17), `updatePaymentIntentMetadata()` (best-effort `paymentIntents.update`) |
| CT clients | `src/clients/{build,create,query,update}.client.js` | Build CT API root, query order (`getOrderWithPaymentInfo`, `getOrder`), `updateOrderTaxTxn` issues `setCustomField` for `connectorStripeTax_transactionReferences` |
| Decoder | `src/utils/decoder.util.js` | `decodeToJson()` — base64 → JSON; throws `CustomError(500, ...)` on parse failure |
| Validators | `src/validators/order-change.validators.js` | `doValidation()` — runs after decode to confirm message shape |
| Custom types | `src/connectors/customTypes.js` | Order custom type (`connector-stripe-tax-calculation-reference`) with `connectorStripeTax_transactionReferences` field |
| Connector | `src/connectors/action.js` | `createChangedOrderSubscription`, `createCustomTypes`, `deleteChangedOrderSubscription`, `deleteCustomTypes` |
| Post-deploy | `src/connectors/post-deploy.js` | Creates Pub/Sub subscription → creates CT custom type |

---

## CT API Extension Trigger Condition

The extension is registered by `tax-calculator/src/connectors/action.js:31` → `createCTPExtension()`. Verbatim condition from current code (widened 2026-06-03, commit `d518598`, "restore tax on carts with payment already attached"):

```text
taxMode="ExternalAmount"
  AND lineItems is defined AND lineItems is not empty
  AND (shippingInfo is defined OR lineItems(shippingDetails is defined))
  AND (
        paymentInfo is not defined
        OR (taxedPrice is not defined AND custom(fields(connectorStripeTax_calculationReferences is defined)))
        OR (shippingMode="Single" AND shippingInfo is defined AND shippingInfo(taxedPrice is not defined)
            AND custom(fields(connectorStripeTax_calculationReferences is defined)))
      )
  AND (taxMode has changed
       OR lineItems has changed
       OR shippingInfo has changed
       OR shippingAddress has changed
       OR shipping has changed
       OR itemShippingAddresses has changed)
```

Trigger metadata:

| Field | Value |
| --- | --- |
| `resourceTypeId` | `cart` |
| `actions` | `Update`, `Create` |
| `timeoutInMs` | `2000` |

Key behaviors:

- `cartState=Frozen` is **not** part of the condition. Triggers occur on Active carts when a cart-changing event fits the predicate.
- The base case, `paymentInfo is not defined`, still stops the extension from firing on ordinary carts once payment has been attached — this is the general rule and holds for the overwhelming majority of carts.
- **Re-apply exception (added 2026-06-03):** commercetools clears `taxedPrice` (or `shippingInfo.taxedPrice` in Single shipping mode) after certain cart mutations — e.g. `setShippingAddress` — **even when `paymentInfo` is already set**. Without the widened condition, such a cart would be left permanently untaxed. When this happens, the extension is allowed through **only if** a Stripe Tax calculation reference already exists on the cart (`connectorStripeTax_calculationReferences` populated) — `tax.calculator.controller.js`'s `isReapplyScenario()` then detects this case and **re-applies the existing calculation** (retrieved by ID) rather than creating a new one, keeping the PaymentIntent, cart, and `order-syncer` on the same `calculationId`. A normal cart with payment attached and no existing calculation reference is still blocked, unaffected by this exception.
- The "has changed" clauses prevent recalculation when no tax-relevant field changed.

---

## CT Custom Types Created by the Connector

### `connector-stripe-tax-calculation-reference` (resourceTypeIds: `order`)

Set by **tax-calculator** (`update-action.service.js` → `createCartCustomTypeUpdateAction`):

| Field | Type | Content |
| --- | --- | --- |
| `connectorStripeTax_calculationReferences` | Set of String | All Stripe Calculation IDs (`taxcalc_xxx`), one per Stripe call |
| `connectorStripeTax_amountTotal` | Number | Sum of `amount_total` across all calculations (cents) |
| `connectorStripeTax_taxAmountExclusive` | Number | Sum of `tax_amount_exclusive` across calculations |
| `connectorStripeTax_taxAmountInclusive` | Number | Sum of `tax_amount_inclusive` across calculations |
| `connectorStripeTax_currencies` | Set of String | `<calc_id>_<CURRENCY>` markers |
| `connectorStripeTax_expiresAt` | Set of String | `<calc_id>_<ISO-8601>` markers |
| `connectorStripeTax_calculationTimestamp` | String | ISO-8601 timestamp set when actions are emitted |

Set by **order-syncer** (`update.client.js` → `updateOrderTaxTxn`):

| Field | Type | Content |
| --- | --- | --- |
| `connectorStripeTax_transactionReferences` | Set of String | Stripe Tax Transaction IDs (`tax_xxx`), one per calculation |

**Cross-module contract risk:** `connectorStripeTax_calculationReferences` is defined as an independent string literal in both `tax-calculator/src/connectors/customTypes.js:12` and `order-syncer/src/connectors/customTypes.js:10`. No shared import ties them together. A rename in one module silently breaks the data contract. See `known-issues.md` Issue 1.

### Tax-code custom types

| Type key (default) | Resource | Field |
| --- | --- | --- |
| `connector-stripe-tax-product` | `product-price`, `line-item` | `connectorStripeTax_TaxCode` (String) |
| `connector-stripe-tax-category` | `category` | `connectorStripeTax_TaxCode` (String) |
| `connector-stripe-tax-shipping` | `shipping-method` | `connectorStripeTax_TaxCode` (String) |

Type keys are overridable via env vars: `CUSTOM_TYPE_PRODUCT_KEY`, `CUSTOM_TYPE_CATEGORY_KEY`, `CUSTOM_TYPE_SHIPPING_KEY`, `CUSTOM_TYPE_CART_KEY`, `CUSTOM_TYPE_ORDER_KEY`.

---

## CT Update Actions Returned by tax-calculator

`update-action.service.js` → `createCartUpdateActionsFromMultipleCalculations()` emits actions in this order:

1. `setCustomType` — applies `connector-stripe-tax-calculation-reference` type and writes all seven `connectorStripeTax_*` fields.
2. `setLineItemTotalPrice` — one per (line item × shippingKey); sets `priceMode` to `ExternalTotal`.
3. `setLineItemTaxAmount` — one per (line item × shippingKey); emitted with `tax = 0` if no breakdown matches.
4. `setShippingMethodTaxAmount` — once per shipping method in Multiple mode; a single action without `shippingKey` in Single mode.
5. `setCartTotalTax` — emits `externalTotalGross` (required for `ExternalAmount` tax mode). Skipped if `amount_total <= 0`.

---

## Tax Calculation Services

| Service | File | Purpose |
| --- | --- | --- |
| TaxBehaviorService | `tax-behavior.service.js` | Determines inclusive/exclusive per country from `TAX_BEHAVIOR_COUNTRY_MAPPING` |
| CategoryService | `category.service.js` | Fetches CT product categories with 5-minute in-memory cache |
| ShipFromService | `ship-from.service.js` | Resolves origin address per line item group |
| TaxCodeService | `tax-code.service.js` | Resolves Stripe tax code from category — **only Strategy 1 (category custom type) is active**; strategies 2–4 commented out (see `known-issues.md` Issue 8) |
| UpdateActionService | `update-action.service.js` | Maps Stripe calculations → CT update actions |

---

## Shipping Modes

| Mode | Behavior |
| --- | --- |
| `Single` | One Stripe request per ship-from group. Single `cart.shippingInfo`. |
| `Multiple` | One Stripe request per (ship-from group × shipping method). Line item amounts split proportionally. Each has its own `shippingKey`. |

Proportional amount formula for Multiple mode:

```text
proportionalAmount = Math.round((lineItem.totalPrice.centAmount * targetQuantity) / lineItem.quantity)
```

---

## Key Configuration

| Variable | Module | Required | Effect |
| --- | --- | --- | --- |
| `STRIPE_API_TOKEN` | both | Yes | Stripe API key for tax calculations and transactions. Note: payment connectors use `STRIPE_SECRET_KEY` instead — different name for the same type of credential. |
| `CTP_PROJECT_KEY` | both | Yes | CT project key |
| `CTP_REGION` | both | Yes | CT region (replaces `CTP_AUTH_URL`/`CTP_API_URL` used by payment connectors) |
| `CTP_CLIENT_ID` | both | Yes | CT OAuth2 client ID |
| `CTP_CLIENT_SECRET` | both | Yes | CT OAuth2 client secret |
| `CTP_SCOPE` | both | No | CT OAuth2 scope |
| `TAX_CODE_CATEGORY_MAPPING_JSON` | tax-calculator | Functionally required | JSON mapping CT categories → Stripe tax codes. Validated at post-deploy but not at runtime startup — absent = all products fail with `TaxCodeNotFoundError` (see `known-issues.md` Issue 4). |
| `TAX_BEHAVIOR_DEFAULT` | tax-calculator | No | Default tax behavior (`inclusive`/`exclusive`) when no country mapping matches |
| `TAX_BEHAVIOR_COUNTRY_MAPPING` | tax-calculator | No | JSON map of country code → tax behavior |
| `SHIP_FROM_REQUIRED` | tax-calculator | No | When `'true'`: validates every group has an address; uses default business address as fallback |
| `SHIP_FROM_DEFAULT_BUSINESS_COUNTRY/STATE/CITY/POSTAL_CODE/LINE1/LINE2` | tax-calculator | No | Default origin address (defaults to New York, NY 10001, US) |
| `SHIP_FROM_CHANNEL_PRIORITY` | tax-calculator | No | Comma-separated channel IDs for address priority |
| `ADDRESS_VALIDATION_STRIPE_DEFAULT_CURRENCY` | tax-calculator | No | Default currency for the ad-hoc Stripe address verification call |
| `CUSTOM_TYPE_PRODUCT_KEY` / `CUSTOM_TYPE_CATEGORY_KEY` / `CUSTOM_TYPE_SHIPPING_KEY` / `CUSTOM_TYPE_CART_KEY` | tax-calculator | No | Override default custom-type keys |
| `CUSTOM_TYPE_ORDER_KEY` | order-syncer | No | Override the order custom-type key |
| `CONNECT_GCP_TOPIC_NAME` | order-syncer | Yes (post-deploy) | Pub/Sub topic name |
| `CONNECT_GCP_PROJECT_ID` | order-syncer | Yes (post-deploy) | GCP project ID |
| `CONNECT_SERVICE_URL` | tax-calculator | Yes (post-deploy) | CT Connect service URL; injected by CT Connect |

---

## Out of Scope

| Feature | Status |
| --- | --- |
| Payment processing | Tax calculation and reporting only; payment is handled by `ct-connect-stripe-checkout` or `ct-connect-stripe-composable` |
| Stripe webhook handling | No Stripe webhooks registered; order sync driven by CT Pub/Sub only |
| Subscription tax calculation | Tax calculated per cart only; subscription renewals not re-calculated |
| Tax refunds / reversal | Reversal of Stripe Tax transactions on refund not implemented |
| Real-time price adjustment | Tax amounts written as CT custom fields; actual CT price not modified |
| Multi-region CT deployments | One deployment per CT project |
| Excluded territory handling | Requests pass through to Stripe Tax with undefined behavior |
| EU VAT OSS reporting | Out of scope |
| Manual tax rate override | No mechanism to bypass Stripe Tax with a manual rate |
