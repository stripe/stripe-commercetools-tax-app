# Architecture — commercetools Stripe Tax Connector

Two-module connector that integrates Stripe Tax with commercetools for real-time tax calculation and automated transaction reporting. Uses CT's native extensibility mechanisms: an API Extension for synchronous calculation and a Pub/Sub subscription for asynchronous order sync.

## At a glance

| Section | What it answers |
| --- | --- |
| [System Overview](#system-overview) | the two flows, end to end |
| [Two Modules](#two-modules) | triggers, endpoints and every status each returns; internals per module |
| [Why one context for both modules](#why-one-context-for-both-modules) | the coupling between the modules |
| [CT API Extension Trigger Condition](#ct-api-extension-trigger-condition) | when commercetools calls the connector, including the re-apply exception |
| [CT Custom Types](#ct-custom-types-created-by-the-connector) | the eight cart fields, the transaction field, the tax-code types |
| [CT Update Actions](#ct-update-actions-returned-by-tax-calculator) | what the connector returns to the cart, in order |
| [Tax Calculation Services](#tax-calculation-services) | one line per service |
| [Shipping Modes](#shipping-modes) | Single vs Multiple |
| [Deploy Lifecycle](#deploy-lifecycle) | what post-deploy and pre-undeploy do |
| [Key Configuration](#key-configuration) | every setting both modules read |
| [Out of Scope](#out-of-scope) | what the connector does not do |
| [Where to go next](#where-to-go-next) | the workflows and rules for each flow |

## System Overview

```text
CT Cart (taxMode=ExternalAmount + lineItems present + state-change condition)
  └── API Extension trigger (synchronous, 2s timeout)
        └── tax-calculator (port 8080, route /taxCalculator)
              ├── Fresh calculation, or re-apply of the stored one (payment attached, tax cleared)
              ├── Resolves the destination from the delivery address
              ├── Resolves tax behavior, tax codes from CT categories, ship-from addresses
              ├── stripe.tax.calculations.create() — one per ship-from group (× shipping key in Multiple mode)
              └── Returns update actions → CT applies them to the cart
                    (setCustomType writes connectorStripeTax_calculationReferences and seven
                     other fields; commercetools carries them to the order)

CT OrderCreated
  └── Subscription → Google Cloud Pub/Sub push (async)
        └── order-syncer (port 8080, route /orderSyncer)
              ├── Decodes message via decodeToJson() (base64 → JSON), validates type and order id
              ├── Reads connectorStripeTax_calculationReferences from the order's custom fields
              ├── No refs:    skip (204)
              ├── Single ref: getTransactionFromTaxCalculation() — createFromCalculation
              ├── Multi ref:  createTaxTransactions() — createFromCalculation per reference, in sequence
              ├── Stores connectorStripeTax_transactionReferences on the order via setCustomField
              └── Best-effort updatePaymentIntentMetadata() writes tax_transactions on the first payment's PaymentIntent
```

## Two Modules

| Module | Trigger | Mode | Port | Endpoints and outcomes |
| --- | --- | --- | --- | --- |
| `tax-calculator/` | CT API Extension on cart `Create`/`Update` | Synchronous | 8080 | `POST /taxCalculator` — 200 `{ actions }` on success (including a partial calculation failure); 400 for a missing cart, an unusable destination, or a missing tax code; 500 when every calculation fails or on an unexpected error. `POST /taxCalculator/validateAddress` — 200 or 400 with the validation result |
| `order-syncer/` | Google Cloud Pub/Sub push from a CT subscription on `OrderCreated` | Asynchronous | 8080 | `POST /orderSyncer` — 204 on success and on a skip (no references); 202 for messages filtered out; 500 for an undecodable message, an API key Stripe refuses while checking references (401/403), or an unexpected error. Only non-2xx is redelivered. Full status table: `business-rules/order-sync.md` Rule 5 |

In required mode an unplaced item is given the default business address — `tax-calculator/src/services/ship-from.service.js:57-59`.

### tax-calculator internals

| Layer | Path | Purpose |
| --- | --- | --- |
| Tax route | `tax-calculator/src/routes/tax.calculator.route.js` | Mounted at `/taxCalculator`; forwards POST to `taxHandler` |
| Tax controller | `tax-calculator/src/controllers/tax.calculator.controller.js` | `taxHandler`: 400 on a missing cart; `isReapplyScenario()` chooses re-apply or a fresh calculation; 200 with `{ actions }`; errors to `TaxErrorHandlerService` |
| Address-validation route | `tax-calculator/src/routes/address.validation.route.js` | Mounted at `/taxCalculator/validateAddress` |
| Address-validation controller | `tax-calculator/src/controllers/address.validation.controller.js` | Calls `addressService.validateAddress`: local rules, then a real Stripe Tax calculation |
| Orchestrator | `tax-calculator/src/services/tax-orchestrator.service.js` | Destination, tax behavior, categories, ship-from groups, requests; parallel Stripe calculations via `Promise.allSettled()`; `reapplyExistingCalculation()` |
| Services | `tax-calculator/src/services/` | `tax-behavior.service.js`, `category.service.js`, `ship-from.service.js`, `tax-code.service.js`, `update-action.service.js`, `address.service.js`, `tax-error-handler.service.js` |
| Custom types | `tax-calculator/src/connectors/customTypes.js` | Cart-tax (declared on `order`), product, category, shipping-method type definitions |
| Connector | `tax-calculator/src/connectors/action.js` | `createCTPExtension`, `validateTaxCodeMapping`, `createCustomTypes`, `deleteCTPExtension`, `deleteCustomTypes` |
| Post-deploy | `tax-calculator/src/connectors/post-deploy.js` | Validates the Stripe Tax account → validates `TAX_CODE_CATEGORY_MAPPING_JSON` when present → creates custom types → replaces the API extension |
| Pre-undeploy | `tax-calculator/src/connectors/pre-undeploy.js` | Calls `deleteCTPExtension` and `deleteCustomTypes(apiRoot, true)` |

### order-syncer internals

| Layer | Path | Purpose |
| --- | --- | --- |
| Route | `order-syncer/src/routes/sync.route.js` | Mounted at `/orderSyncer`; forwards POST to `syncHandler` |
| Controller | `order-syncer/src/controllers/sync.controller.js` | `syncHandler` + `syncOrderToTaxProvider` — decodes, validates, fetches the order, branches on zero / one / several calculation references, updates CT, writes PaymentIntent metadata |
| Stripe client | `order-syncer/src/extensions/stripe/clients/client.js` | `getTransactionFromTaxCalculation()` (single ref), `createTaxTransactions()` (loop over multi refs), `updatePaymentIntentMetadata()` (best-effort `paymentIntents.update`) |
| CT clients | `order-syncer/src/clients/{build,create,query,update}.client.js` | Build CT API root; query order (`getOrderWithPaymentInfo`, `getOrder`); `updateOrderTaxTxn` re-reads the order for its version and issues `setCustomField` for `connectorStripeTax_transactionReferences` |
| Decoder | `order-syncer/src/utils/decoder.util.js` | `decodeToJson()` — base64 → JSON; throws `CustomError(500, ...)` on parse failure |
| Validators | `order-syncer/src/validators/order-change.validators.js` | `doValidation()` — skips `ResourceCreated` notifications (204) and anything that is not an `OrderCreated` message about an order with an id (202) |
| Custom types | `order-syncer/src/connectors/customTypes.js` | Order custom type (`CUSTOM_TYPE_ORDER_KEY`, default `connector-stripe-tax-calculation-reference`) with `connectorStripeTax_transactionReferences` only |
| Connector | `order-syncer/src/connectors/action.js` | `createChangedOrderSubscription`, `createCustomTypes`, `deleteChangedOrderSubscription`, `deleteCustomTypes` |
| Post-deploy | `order-syncer/src/connectors/post-deploy.js` | Replaces the Pub/Sub subscription → adds the transaction field to every order type and creates its own |
| Pre-undeploy | `order-syncer/src/connectors/pre-undeploy.js` | Deletes the subscription → removes the transaction field |

---

## Why one context for both modules

The two modules share one `context/`. Placement was decided by three questions:

| Question | Answer | Evidence |
| --- | --- | --- |
| Do they ship in one manifest? | Yes | Both apps are declared in the one `connect.yaml` (`connect.yaml:2-4`, `:55-57`) |
| Can either be operated usefully on its own? | No | Each can run alone, but neither produces a useful result without the other: `order-syncer` alone finds no calculation references to file, and `tax-calculator` alone calculates tax that is never reported |
| Does one depend on a contract the other publishes? | Yes — through platform data, not code | No import and no HTTP call crosses the modules. `tax-calculator` writes `connectorStripeTax_calculationReferences` on the cart (`tax-calculator/src/services/update-action.service.js:207`); commercetools carries it to the order; `order-syncer` reads it (`order-syncer/src/controllers/sync.controller.js:85`). Each module declares the field name on its own (`tax-calculator/src/connectors/customTypes.js:12`, `order-syncer/src/connectors/customTypes.js:10`). `order-syncer` also depends, before filing, on the line-item stamps `tax-calculator` writes into each calculation, on its own copies of two `tax-calculator` definitions, and on a test fixture both suites share — still with no import (`business-rules/calculation-reference-contract.md` Rule 6) |

---

## CT API Extension Trigger Condition

The extension is registered by `tax-calculator/src/connectors/action.js:31` → `createCTPExtension()`. Condition from current code:

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
| `destination` | `HTTP`, `CONNECT_SERVICE_URL` |

Key behaviors:

- `cartState=Frozen` is **not** part of the condition. Triggers occur on Active carts when a cart-changing event fits the predicate.
- The base case, `paymentInfo is not defined`, still stops the extension from firing on ordinary carts once payment has been attached.
- **Re-apply exception:** commercetools clears `taxedPrice` (or `shippingInfo.taxedPrice` in Single shipping mode) after certain cart mutations — e.g. `setShippingAddress` — even when `paymentInfo` is already set. The extension is then allowed through **only if** a calculation reference already exists on the cart. `isReapplyScenario()` re-applies when the reference list is non-empty (`tax-calculator/src/controllers/tax.calculator.controller.js:12-23`). `reapplyExistingCalculation()` retrieves the first stored calculation, reads its destination from the calculation's own `customer_details.address`, and compares at jurisdiction granularity against the cart's current destination: on a match it replays the stored calculation; on a difference it recalculates. A Multiple-shipping cart recalculates. A retrieve that returns `resource_missing`/404 recalculates; any other retrieve error is re-thrown. See `business-rules/tax-calculation.md` Rules 2 and 8.
- The "has changed" clauses prevent recalculation when no tax-relevant field changed. A change of `cart.country` alone does not trigger.

---

## CT Custom Types Created by the Connector

### `connector-stripe-tax-calculation-reference` (resourceTypeIds: `order`)

Set on the **cart** by **tax-calculator** (`tax-calculator/src/services/update-action.service.js:199-216` → `createCartCustomTypeUpdateAction`, via `setCustomType`); the type key is `CUSTOM_TYPE_CART_KEY`. Eight fields:

| Field | Type | Content |
| --- | --- | --- |
| `connectorStripeTax_calculationReferences` | Set of String | All successful Stripe Calculation IDs (`taxcalc_xxx`), one per Stripe call |
| `connectorStripeTax_amountTotal` | Number | Sum of `amount_total` across the successful calculations (cents) |
| `connectorStripeTax_taxAmountExclusive` | Number | Sum of `tax_amount_exclusive` across calculations |
| `connectorStripeTax_taxAmountInclusive` | Number | Sum of `tax_amount_inclusive` across calculations |
| `connectorStripeTax_currencies` | Set of String | `<calc_id>_<CURRENCY>` markers |
| `connectorStripeTax_expiresAt` | Set of String | `<calc_id>_<ISO-8601>` markers |
| `connectorStripeTax_calculationTimestamp` | String | ISO-8601 timestamp set when actions are emitted |
| `connectorStripeTax_destinationCountry` | String | The destination countries of the requests sent, sorted and comma-joined |

Set on the **order** by **order-syncer** (`order-syncer/src/clients/update.client.js:14-17` → `updateOrderTaxTxn`, via `setCustomField`):

| Field | Type | Content |
| --- | --- | --- |
| `connectorStripeTax_transactionReferences` | Set of String | Stripe Tax Transaction IDs (`tax_xxx`), one per calculation; replaces the previous value |

This field is defined by `order-syncer`'s type and is added to other `order` types by its post-deploy.

### Tax-code custom types

| Type key (default) | Resource | Field |
| --- | --- | --- |
| `connector-stripe-tax-product` | `product-price`, `line-item` | `connectorStripeTax_TaxCode` (String) |
| `connector-stripe-tax-category` | `category` | `connectorStripeTax_TaxCode` (String) — the only source of a line item's tax code |
| `connector-stripe-tax-shipping` | `shipping-method` | `connectorStripeTax_TaxCode` (String) — the shipping tax code |

Type keys are overridable via env vars: `CUSTOM_TYPE_PRODUCT_KEY`, `CUSTOM_TYPE_CATEGORY_KEY`, `CUSTOM_TYPE_SHIPPING_KEY`, `CUSTOM_TYPE_CART_KEY` (tax-calculator), `CUSTOM_TYPE_ORDER_KEY` (order-syncer).

---

## CT Update Actions Returned by tax-calculator

`tax-calculator/src/services/update-action.service.js` → `createCartUpdateActionsFromMultipleCalculations()` emits actions in this order on a fresh calculation:

1. `setCustomType` — applies `connector-stripe-tax-calculation-reference` and writes all eight `connectorStripeTax_*` fields.
2. `setLineItemTotalPrice` — one per (line item × shippingKey); sets an external line total, which moves the line to `priceMode` `ExternalTotal`. The total is Stripe's line `amount`.
3. `setLineItemTaxAmount` — one per (line item × shippingKey); emitted with `tax = 0` if no breakdown matches.
4. `setShippingMethodTaxAmount` — once per shipping key in Multiple mode; a single action without `shippingKey` in Single mode, possibly zero, possibly absent (`business-rules/calculation-results.md` Rule 4, *Single-mode shipping tax is one unkeyed action — possibly zero, possibly absent*).
5. `setCartTotalTax` — emits `externalTotalGross` (required for `ExternalAmount` tax mode). Skipped if `amount_total <= 0`.

A re-apply emits only `setLineItemTaxAmount`, an optional Single-mode `setShippingMethodTaxAmount` and an optional `setCartTotalTax`, all from the first stored calculation — no `setCustomType` and no `setLineItemTotalPrice` (`tax-calculator/src/services/tax-orchestrator.service.js:743-758`). The required order is `business-rules/tax-calculation.md` Rule 3, *Update action ordering is mandatory*.

---

## Tax Calculation Services

| Service | File | Purpose |
| --- | --- | --- |
| TaxBehaviorService | `tax-behavior.service.js` | Determines inclusive/exclusive from the destination country via `TAX_BEHAVIOR_COUNTRY_MAPPING`, then `TAX_BEHAVIOR_DEFAULT`, else none |
| CategoryService | `category.service.js` | Fetches CT product categories (one query, batched above 500 products) with a 5-minute in-memory cache |
| ShipFromService | `ship-from.service.js` | Resolves the origin address per line item: supply channel → inventory → default address |
| TaxCodeService | `tax-code.service.js` | Resolves the Stripe tax code from the category custom type; shipping tax code from the shipping method |
| UpdateActionService | `update-action.service.js` | Maps Stripe calculations → CT update actions |
| AddressService | `address.service.js` | Local address rules, then a Stripe verification calculation |
| TaxErrorHandlerService | `tax-error-handler.service.js` | Maps errors to CT extension responses (`business-rules/error-responses.md`) |

All under `tax-calculator/src/services/`.

---

## Shipping Modes

| Mode | Behavior |
| --- | --- |
| `Single` | One Stripe request per ship-from group. Single `cart.shippingInfo`. |
| `Multiple` | One Stripe request per (ship-from group × shipping key). Line item amounts split by target quantity. Each has its own `shippingKey`. Any `shippingMode` other than `'Single'` is built this way. |

Proportional amount formula for Multiple mode (`tax-calculator/src/services/tax-orchestrator.service.js:450`):

```text
proportionalAmount = Math.round((lineItem.totalPrice.centAmount * targetQuantity) / lineItem.quantity)
```

The request-building rules are `business-rules/calculation-requests.md`.

---

## Deploy Lifecycle

| Script | tax-calculator | order-syncer |
| --- | --- | --- |
| Post-deploy | Requires `STRIPE_API_TOKEN` and `CONNECT_SERVICE_URL`; refuses unless Stripe Tax is active with a head office; validates the category mapping when present; adds connector fields to existing types and creates its own; **deletes then recreates** the API extension | Reads `CONNECT_GCP_TOPIC_NAME` / `CONNECT_GCP_PROJECT_ID`; **deletes then recreates** the `OrderCreated` subscription; adds the transaction field to every `order` type and creates its own |
| Pre-undeploy | Deletes the extension; strips connector fields from matching types, deleting single-field types | Deletes the subscription; same field cleanup |

Rules: `business-rules/deploy-lifecycle.md`. Steps: `workflows/process-deploy-and-undeploy.md`.

---

## Key Configuration

"Required" means the module's primary function does not run without it.

| Variable | Module | Required | Effect |
| --- | --- | --- | --- |
| `STRIPE_API_TOKEN` | both | Yes | Stripe API key for tax calculations and transactions. Validated by `order-syncer`'s `readConfiguration()`. Note: payment connectors use `STRIPE_SECRET_KEY` instead — different name for the same type of credential. |
| `CTP_PROJECT_KEY` | both | Yes | CT project key |
| `CTP_REGION` | both | Yes | CT region, one of five allowed values (replaces `CTP_AUTH_URL`/`CTP_API_URL` used by payment connectors) |
| `CTP_CLIENT_ID` | both | Yes | CT OAuth2 client ID (exactly 24 characters) |
| `CTP_CLIENT_SECRET` | both | Yes | CT OAuth2 client secret (exactly 32 characters) |
| `CTP_SCOPE` | both | No | CT OAuth2 scope; falls back to `'default'` |
| `TAX_CODE_CATEGORY_MAPPING_JSON` | tax-calculator | No | JSON mapping CT categories → Stripe tax codes. Validated at post-deploy when present; at runtime tax codes come only from the category custom field (`business-rules/tax-code-resolution.md` Rule 5, *`TAX_CODE_CATEGORY_MAPPING_JSON` is checked at deploy and ignored at runtime*) |
| `TAX_BEHAVIOR_DEFAULT` | tax-calculator | No | `inclusive`/`exclusive` when no country mapping matches; unset → no behavior sent. Manifest default `exclusive` |
| `TAX_BEHAVIOR_COUNTRY_MAPPING` | tax-calculator | No | JSON map of upper-case country code → tax behavior. Manifest default maps nine countries, seven of them `inclusive` |
| `SHIP_FROM_REQUIRED` | tax-calculator | No | Only the exact string `'true'` enables it: an unresolved item then takes the default business address; it does not fail the cart (`business-rules/ship-from.md` Rule 3, *`SHIP_FROM_REQUIRED` decides whether an unresolved item gets the default address, not whether it fails*). Manifest default `'true'`; unset in code means not required |
| `SHIP_FROM_DEFAULT_BUSINESS_COUNTRY/STATE/CITY/POSTAL_CODE/LINE1/LINE2` | tax-calculator | No | Default origin address in required mode (falls back to New York, NY 10001, US) |
| `SHIP_FROM_CHANNEL_PRIORITY` | tax-calculator | No | Comma-separated channel IDs for inventory address priority |
| `ADDRESS_VALIDATION_STRIPE_DEFAULT_CURRENCY` | tax-calculator | No | Currency for the address verification call, for countries outside a built-in 24-country map (default `usd`) |
| `CUSTOM_TYPE_PRODUCT_KEY` / `CUSTOM_TYPE_CATEGORY_KEY` / `CUSTOM_TYPE_SHIPPING_KEY` / `CUSTOM_TYPE_CART_KEY` | tax-calculator | No | Override default custom-type keys; defaults declared in the manifest match the code |
| `CUSTOM_TYPE_ORDER_KEY` | order-syncer | No | Override the order custom-type key; used by the deploy scripts only. Must equal `CUSTOM_TYPE_CART_KEY` |
| `CONNECT_SERVICE_URL` | tax-calculator | Yes (post-deploy) | The extension's destination URL; supplied by CT Connect, not declared in the manifest |
| `CONNECT_GCP_TOPIC_NAME` | order-syncer | Yes (post-deploy) | Pub/Sub topic name; supplied by CT Connect, not declared in the manifest |
| `CONNECT_GCP_PROJECT_ID` | order-syncer | Yes (post-deploy) | GCP project ID; supplied by CT Connect, not declared in the manifest |

---

## Out of Scope

| Feature | Status |
| --- | --- |
| Payment processing | Tax calculation and reporting only; payment is handled by the payment connectors that read the calculation reference |
| Stripe webhook handling | No Stripe webhooks registered; order sync driven by CT Pub/Sub only |
| Subscription tax calculation | Tax calculated per cart only; subscription renewals not re-calculated |
| Tax refunds / reversal | Reversal of Stripe Tax transactions on refund not implemented |
| Multi-region CT deployments | One deployment per CT project (the extension key is fixed) |
| Excluded territory handling | No special handling; requests pass through to Stripe Tax |
| EU VAT OSS reporting | Out of scope |
| EU VAT number validation | Not implemented |
| Manual tax rate override | No mechanism to override Stripe Tax with a manual rate |

The connector does set CT prices: `setLineItemTotalPrice` writes an external line total on every fresh calculation. The full list of absences is `adopter-guide.md` §2, "What this connector does not do".

---

## Where to go next

| Flow | Workflow | Rules |
| --- | --- | --- |
| Cart calculation, end to end | `workflows/process-tax-orchestration.md`, `workflows/process-update-action-creation.md` | `business-rules/tax-calculation.md`, `calculation-requests.md`, `calculation-results.md`, `error-responses.md` |
| Re-apply after payment | `workflows/process-stored-calculation-reapply.md` | `business-rules/tax-calculation.md` Rules 2, 7 and 8 |
| Destination and tax behavior | `workflows/process-tax-behavior-determination.md` | `business-rules/tax-destination.md`, `tax-behavior.md` |
| Tax codes | `workflows/process-category-retrieval.md`, `process-category-taxcode-selection.md`, `process-shipping-taxcode-selection.md` | `business-rules/tax-code-resolution.md` |
| Ship-from | `workflows/process-ship-from-selection.md` | `business-rules/ship-from.md` |
| Address check | `workflows/process-address-validation.md` | `business-rules/address-validation.md` |
| Order sync | `workflows/process-order-tax-transaction-sync.md` | `business-rules/order-sync.md`, `calculation-reference-contract.md` |
| Deploy and undeploy | `workflows/process-deploy-and-undeploy.md` | `business-rules/deploy-lifecycle.md` |
