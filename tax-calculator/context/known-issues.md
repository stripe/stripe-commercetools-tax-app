# Known Issues — tax-calculator

Ordered by severity (HIGH first). Every entry traces to the Module Map.

## Issue 1: Category-based tax-code resolution is dead code (only category custom-type field works)

**Problem:** Only STRATEGY 1 (category custom-type field `connectorStripeTax_TaxCode`) is active. STRATEGY 2 (product custom field), STRATEGY 3 (`TAX_CODE_CATEGORY_MAPPING_JSON` category mapping), and STRATEGY 4 (parent-category traversal) are all commented out. Any product whose category lacks the `connectorStripeTax_TaxCode` custom field throws `TaxCodeNotFoundError`, even when a valid mapping is configured. The entire `TAX_CODE_CATEGORY_MAPPING_JSON` config — validated at post-deploy, loaded by `taxCodeMapping.config.js` — is never consulted at runtime.
**Root cause:** Strategies 2-4 are commented out in `src/services/tax-code.service.js:36-69`.
**Rule:** Do not assume `TAX_CODE_CATEGORY_MAPPING_JSON` (or product custom fields, or parent-category inheritance) affects tax code resolution. Verify against `tax-code.service.js:36-69` before relying on any strategy other than the category custom-type field. Every product's category must carry the `connectorStripeTax_TaxCode` custom field.
**Implementation note:** `src/services/tax-code.service.js:36-69`; config loaded but unused at `src/config/taxCodeMapping.config.js:24`.

---

## Issue 2: Partial Stripe tax failures produce incomplete tax

**Problem:** When some parallel `tax.calculations.create` calls fail, they are dropped (logged as `warn` only) and the service returns update actions covering only the successful calculations — under-reporting tax on the cart. Only total failure (all calls fail) throws. This is a tax-compliance risk.
**Root cause:** `Promise.allSettled` result handling drops rejected calculations instead of failing the request.
**Rule:** A partial Stripe failure must not silently yield a cart with under-reported tax. Any change here must decide explicitly whether a partial failure should fail the whole request or surface an error to the caller. Do not treat a returned set of update actions as proof that all ship-from/shipping-method groups were calculated.
**Implementation note:** `src/services/tax-orchestrator.service.js:535-587` (Stripe call at `:546`).

---

## Issue 3: No request authentication on /taxCalculator/validateAddress

**Problem:** The address-validation endpoint has no request authentication. If reachable from a merchant UI, it violates the hub rule requiring JWT verification on merchant-callable endpoints and exposes an unauthenticated endpoint that calls Stripe.
**Root cause:** No auth middleware on the route or controller.
**Rule:** Any merchant-callable endpoint requires JWT verification (hub Global Coding Rule). Before exposing this endpoint to a UI, add request auth. Do not treat this endpoint as safe to expose publicly.
**Implementation note:** `src/routes/address.validation.route.js:6`; `src/controllers/address.validation.controller.js:14`.

---

## Issue 4: No request authentication / signature verification on /taxCalculator/ tax endpoint

**Problem:** The tax endpoint has no request authentication or signature verification. It relies solely on CT API Extension platform delivery; no HMAC or auth header is configured on the extension destination.
**Root cause:** No auth on route; extension destination has no auth header (`src/connectors/action.js:22-35`).
**Rule:** Event/webhook-style endpoints may rely on platform delivery auth, but this depends on CT extension delivery being the only reachable path. Confirm the endpoint is not otherwise reachable, and prefer configuring an authentication header (HMAC) on the extension destination.
**Implementation note:** `src/routes/tax.calculator.route.js:7`; extension registration at `src/connectors/action.js:22-35`.

---

## Issue 5: Ship-from resolution swallows CT channel/inventory API errors

**Problem:** Ship-from resolution catches CT channel/inventory API errors and returns null. A transient CT failure silently degrades to no ship-from (or the default address), producing a different tax result with no error surfaced.
**Root cause:** try/catch returns null on error instead of propagating.
**Rule:** Distinguish "no ship-from configured" from "ship-from lookup failed". A transient API failure must not be indistinguishable from an absent ship-from, because the two produce different (and silently wrong) tax results.
**Implementation note:** `src/services/ship-from.service.js:111-114,161-164` (calls at `:96`, `:125`).

---

## Issue 6: Category batch fetch swallows failed batches

**Problem:** Category batch fetching uses `allSettled` and skips failed batches (logged as error only). Products in a failed batch get empty categories, which downstream causes `TaxCodeNotFoundError` or a wrong tax code, with no failure surfaced to the caller.
**Root cause:** Failed batches are logged and skipped in the batch path.
**Rule:** A failed category batch must not silently yield products with empty categories. Any batch failure that affects tax-code resolution should surface, not be swallowed.
**Implementation note:** `src/services/category.service.js:201-213` (query at `:145`).

---

## Issue 7: errorMiddleware defined but never registered

**Problem:** `errorMiddleware` is defined but never registered via `app.use` in `index.js` — it is a dead error handler. Errors are not routed through it.
**Root cause:** Missing `app.use(errorMiddleware)` registration.
**Rule:** If centralized error handling is intended, register the middleware; otherwise remove it to avoid the illusion of a global handler.
**Implementation note:** `src/middlewares/error.middleware.js:11`; missing registration around `src/index.js:19-21`.

---

## Issue 8: address.service instantiates Stripe client at import time bypassing config validation

**Problem:** `address.service.js` instantiates the Stripe client at import time directly from `process.env.STRIPE_API_TOKEN`, bypassing the `configUtils` validation used elsewhere and diverging from the singleton `createStripeClient`. If the var is unset, the client is still created and fails only on call.
**Root cause:** Direct `process.env` read at module load (`src/services/address.service.js:5`).
**Rule:** Read Stripe credentials through the validated config path / singleton client, not directly from `process.env` at import time.
**Implementation note:** `src/services/address.service.js:5`.

---

## Issue 9: extractCustomerAddress uses cart.country regardless of per-shipment address in Multiple mode

**Problem:** `extractCustomerAddress` always uses `cart.country` for the customer address country regardless of the per-shipment shipping address country in Multiple shipping mode. Cross-border shipments to a country different from `cart.country` may be taxed against the wrong country.
**Root cause:** Country is taken from `cart.country` rather than the per-shipment shipping address.
**Rule:** In Multiple shipping mode, tax must be computed against each shipment's actual destination country, not the cart-level country.
**Implementation note:** `src/services/tax-orchestrator.service.js:504-511`.

---

## Issue 10: getShippingTaxCodeFromShippingInfo dereferences shippingMethod.id with no null guard

**Problem:** `getShippingTaxCodeFromShippingInfo` dereferences `shippingInfo.shippingMethod.id` with no null guard. A `shippingInfo` without a `shippingMethod` throws an unhandled `TypeError` during orchestration.
**Root cause:** Missing null check before dereference (`src/services/tax-code.service.js:264`).
**Rule:** Guard optional CT fields (`shippingMethod` may be absent) before dereferencing.
**Implementation note:** `src/services/tax-code.service.js:264`.

---

## Issue 11: Hardcoded fallback country 'US' / currency 'USD' across update-action.service

**Problem:** `update-action.service.js` falls back to a hardcoded country `'US'` and currency `'USD'` in multiple update actions. A non-US merchant, or a cart in an unexpected state where country/currency is missing, could get tax computed against the wrong jurisdiction/currency with no error surfaced.
**Root cause:** Hardcoded `'US'` / `'USD'` fallbacks rather than deriving from cart/config.
**Rule:** Fallback jurisdiction and currency must not be silently assumed to be US/USD for a non-US merchant. A missing country/currency should be surfaced or derived from the cart, not defaulted.
**Implementation note:** `'US'` at `src/services/update-action.service.js:397,649,914,1210`; `'USD'` at `:180,534,681,906,1159`.

---

## Issue 12: Hardcoded 'exclusive' tax_behavior forced on shipping cost

**Problem:** Shipping cost is always sent to Stripe with `tax_behavior='exclusive'`, regardless of `TAX_BEHAVIOR_DEFAULT` or `TAX_BEHAVIOR_COUNTRY_MAPPING`. A merchant configured for inclusive tax display will see shipping taxed inconsistently with line items.
**Root cause:** Hardcoded `'exclusive'` on the shipping cost path.
**Rule:** Shipping `tax_behavior` should respect the configured tax behavior (or its inconsistency should be a documented, deliberate decision), not be silently forced to `'exclusive'`.
**Implementation note:** `src/services/tax-orchestrator.service.js:277,397`.

---

## Issue 13: TaxCodeShippingNotFoundError defined and handled but never thrown

**Problem:** `TaxCodeShippingNotFoundError` is handled in the error handler and defined as an error class, but is never thrown anywhere — shipping tax-code lookup returns null instead. This is a dead error path.
**Root cause:** Shipping tax-code lookup returns null rather than throwing.
**Rule:** Either throw the defined error where the null-return currently occurs, or remove the dead handler/class to avoid implying a code path that never runs.
**Implementation note:** `src/services/tax-error-handler.service.js:34`; `src/errors/taxCodeShippingNotFound.error.js`.

---

## Issue 14: Multiple dead/unused tax-code methods retained

**Problem:** Several methods are retained but unused: `findFirstTaxCodeInHierarchy`, `getCustomFieldTaxCode`, `getCategoryTaxCode`, `getParentCategoryTaxCode`, `traverseParentChain` (all in `tax-code.service.js`); `logTaxCodeDecision` is referenced only in commented code.
**Root cause:** Dead code left in place after strategies 2-4 were commented out (see Issue 1).
**Rule:** Do not read these methods as evidence of live behavior. Removing them requires confirming no runtime path calls them.
**Implementation note:** `src/services/tax-code.service.js:113-255,328`.

---

## Issue 15: No idempotency key on tax.calculations.create

**Problem:** Repeated CT extension firings create duplicate Stripe tax calculations because no idempotency key is passed. This does not follow the hub idempotency rule. Impact is low because calculations are ephemeral.
**Root cause:** No idempotency key on the Stripe call.
**Rule:** The hub idempotency rule (keys derived from platform entity identity) is not applied here. If persistence or cost becomes a concern, add an idempotency key derived from cart identity.
**Implementation note:** `src/services/tax-orchestrator.service.js:546`.

---

## Issue 16: readConfiguration reads STRIPE_API_TOKEN but the env validator does not validate it

**Problem:** `readConfiguration` reads `STRIPE_API_TOKEN`, but the env-var validator set has no presence check for it, so a missing token passes config validation and fails later at the Stripe call.
**Root cause:** No presence validator for `STRIPE_API_TOKEN` in the validator set.
**Rule:** A required credential should fail fast at config validation, not at first Stripe call. Add a presence check if this token is required.
**Implementation note:** `src/utils/config.util.js:19`; `src/validators/env-var.validators.js:14-68`.
