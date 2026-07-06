# Feature Scope — tax-calculator

## What is Supported

- **External-amount tax calculation on carts.** Receives a commercetools cart via the CT API Extension on cart Create/Update, but only when the cart's `taxMode="ExternalAmount"` (the extension trigger predicate at `src/connectors/action.js:31`). Carts in any other tax mode never invoke this service.
- **Per-line-item tax-code resolution** via the category custom-type field `connectorStripeTax_TaxCode` (`src/services/tax-code.service.js:36-69`). This is the only active strategy.
- **Per-shipment ship-from resolution** through a channel → inventory → default fallback chain (`src/services/ship-from.service.js`), so cross-border and multi-warehouse carts can be taxed from the correct origin.
- **Parallel Stripe Tax calculation.** Calls `tax.calculations.create` once per ship-from / shipping-method group in parallel via `Promise.allSettled` (`src/services/tax-orchestrator.service.js:546`).
- **CT cart update actions.** Translates Stripe results into commercetools cart update actions with tax rates per line item and per shipping method (`src/services/update-action.service.js`).
- **Address validation endpoint.** `POST /taxCalculator/validateAddress` probes Stripe Tax with a $1.00 test calculation (amount `100`, default tax code `txcd_99999999`, `address_source=shipping`) and returns the full validation result `{ success, validation: { local, stripe }, address: { suggestions } }` built by `buildValidationResult` (`src/services/address.service.js:196-205`). The controller returns HTTP 400 when `success` is false and HTTP 200 (`HTTP_STATUS_SUCCESS_ACCEPTED`) otherwise, returning the same object in both cases (`src/controllers/address.validation.controller.js:51-55`). Note: `{ accepted: true/false }` is **not** the top-level response — `accepted` is only a nested field at `validation.stripe.accepted`, produced by the internal `verifyAddressWithStripe` helper (`src/services/address.service.js:176`).
- **Deploy / undeploy lifecycle hooks.** `post-deploy.js` validates Stripe Tax settings, creates the CT custom types and the CT API Extension; `pre-undeploy.js` removes them.

## What is Out of Scope

The tax-code resolution logic in `tax-code.service.js` contains four strategies, but **only one is live**. The following three strategies are present in the source but **commented out and never executed** (`src/services/tax-code.service.js:36-69`):

1. **Product custom-field tax code** (`getCustomFieldTaxCode`) — dead code.
2. **JSON category-mapping tax code** (`TAX_CODE_CATEGORY_MAPPING_JSON`) — dead code. **Despite `TAX_CODE_CATEGORY_MAPPING_JSON` being validated at post-deploy and loaded by `taxCodeMapping.config.js`, it is never read at runtime.** Configuring it has no effect on tax calculation. This is a capability gap, not merely a code-quality issue — a merchant can set the mapping, see it validated at deploy, and still have products throw `TaxCodeNotFoundError`.
3. **Parent-category traversal** (`getParentCategoryTaxCode` / `traverseParentChain`) — dead code.

Because of this, the effective supported behavior is narrower than the configuration surface suggests: **a product whose own category lacks the `connectorStripeTax_TaxCode` custom field cannot be taxed**, even if a valid `TAX_CODE_CATEGORY_MAPPING_JSON` entry exists for it. See `context/known-issues.md` Issue 1.

Also out of scope:

- **No request authentication** on either HTTP endpoint (both tax and validateAddress). There is no JWT or HMAC verification; delivery trust relies solely on the CT platform for the tax endpoint, and the validateAddress endpoint is entirely unauthenticated.
- **No idempotency** on Stripe tax calculations — repeated extension firings create duplicate (ephemeral) Stripe calculations.
- **No automatic reconciliation** of Stripe vs CT amounts; the service only returns update actions.

## Configuration-Driven Behavior

- **Ship-from defaults** — when channel and inventory resolution both fail (or are absent), ship-from falls back to `SHIP_FROM_DEFAULT_BUSINESS_*` env vars, which default to a New York, US address (`10001`). `SHIP_FROM_CHANNEL_PRIORITY` (default `[]`) orders which channels are tried; `SHIP_FROM_REQUIRED` (default falsey) controls whether a missing ship-from is tolerated or treated as an error.
- **Tax behavior** — `TAX_BEHAVIOR_DEFAULT` (inclusive/exclusive) and `TAX_BEHAVIOR_COUNTRY_MAPPING` (per-country override JSON) determine the `tax_behavior` sent to Stripe for line items. **Shipping cost is exempt**: it is always forced to `'exclusive'` (`tax-orchestrator.service.js:277,397`) regardless of these settings — see `context/known-issues.md`.
- **Custom type keys** — `CUSTOM_TYPE_PRODUCT_KEY`, `CUSTOM_TYPE_CATEGORY_KEY`, `CUSTOM_TYPE_SHIPPING_KEY`, `CUSTOM_TYPE_CART_KEY` let deployers override the CT custom-type keys created at post-deploy.
- **Address-validation currency** — `ADDRESS_VALIDATION_STRIPE_DEFAULT_CURRENCY` (default `'usd'`) sets the currency for the test calculation, with a hardcoded country→currency map as a per-country override (`address.service.js:282-308`).
