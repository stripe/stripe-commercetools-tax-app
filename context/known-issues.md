# Known Issues — ct-stripe-tax

Connector-specific limitations, code defects, and operational gotchas across both modules (`tax-calculator`, `order-syncer`). Cross-cutting issues shared with the payment connectors are documented in the hub `../../context/known-issues.md` — cross-references are noted below.

`tax-calculator` and `order-syncer` are treated as **one Connector Unit** (single shared `context/`, per the hub's 3-Test Rule) — not split by module. They share one `connect.yaml` (T1✅) and are never adopted independently, and although each can technically run without the other (T2✅) and there is no direct code import or HTTP call between them (T3, narrowly read, ❌), they communicate through a real producer→consumer data contract via commercetools custom fields: `tax-calculator` calculates and writes `connectorStripeTax_calculationReferences`; `order-syncer` reads it and creates the Stripe Tax transaction. That is a genuine API-contract-equivalent coupling the hub's 3-Test Rule (as written) did not originally account for — see `../../context/decisions/003-context-role-classification.md` addendum (2026-07-28) for the correction.

---

## Cross-module (affects both `tax-calculator` and `order-syncer` identically)

### Issue 1: `connectorStripeTax_calculationReferences` field name duplicated as an independent string literal in both modules

**Problem:** The field name `connectorStripeTax_calculationReferences` is defined as an independent string literal in `tax-calculator/src/connectors/customTypes.js:12` and `order-syncer/src/connectors/customTypes.js:10`. No shared import or constant ties them together. A rename in either file silently breaks the runtime data contract: `order-syncer` fails to find calculation references on the order. The same duplication applies to `connectorStripeTax_transactionReferences`.
**Root cause:** No canonical shared source for a field name both modules must agree on — enforced only by two separately-maintained string literals, despite this being the connector's central producer→consumer contract (see the note above).
**Rule:** Runtime data contracts shared between modules of the same connector must use a single canonical source, or at minimum a documented cross-reference so a rename in one triggers a review of the other.
**What breaks if violated:** A rename in either module's `customTypes.js` silently breaks tax reporting — `order-syncer` treats every order as having no calculation references, with no error surfaced (see Issue 15 below for the resulting silent-skip behavior).

### Issue 2: Neither module registers its own `errorMiddleware` on the Express app

**Problem:** An `error.middleware.js` file exists in both `tax-calculator/src` and `order-syncer/src` defining an Express error handler, but neither module's `index.js` calls `app.use(errorMiddleware)`. Unhandled errors fall through to the default Express error handler, which returns a generic HTML 500 response instead of a structured JSON error response that CT API Extensions and Pub/Sub can parse.
**Root cause:** Same omission independently present in both modules — `error.middleware.js` defined but never registered.
**Rule:** Express error middleware must be registered as the last `app.use()` call in every module of this connector.
**What breaks if violated:** CT API Extensions expect a JSON response body — an HTML 500 from the default Express handler may cause CT to treat the extension response as malformed, with a less diagnosable failure than a structured error would give.

### Issue 26 (found via `/docs-audit`, 2026-07-28): `readConfiguration()`'s string statusCode crashes the response path in both modules, not just `order-syncer`

**Problem:** Both `tax-calculator/src/utils/config.util.js:28-32` and `order-syncer/src/utils/config.util.js:24-28` throw `CustomError('InvalidEnvironmentVariablesError', ...)` — a **string**, not a number, as `statusCode`. In `order-syncer` this reaches `sync.controller.js:58`'s `response.status(err.statusCode)` (Issue 20). In `tax-calculator`, the same class of crash exists on a live-request path: `tax-behavior.service.js:142`'s `getCachedConfiguration()` calls `readConfiguration()` on every cache-TTL refresh (5 min) — if env vars are invalid at that moment, the thrown error propagates through `taxHandler`'s try/catch (`tax.calculator.controller.js:64-66`) into `TaxErrorHandlerService.handleTaxCalculationError()` → `handleOtherErrors()` (`tax-error-handler.service.js:190-191`), which does `if (error.statusCode) return response.status(error.statusCode).send(error)` — no numeric-type check, unlike `error.middleware.js`'s (unregistered, see Issue 2) correct check. `response.status('InvalidEnvironmentVariablesError')` throws, since Express requires a numeric status code.
**Root cause:** Both modules' `CustomError` constructors accept a non-numeric `statusCode` with no validation, and both modules have at least one call site (`handleOtherErrors` in tax-calculator, `sync.controller.js` in order-syncer) that assumes `statusCode` is always numeric without checking.
**Rule:** All `CustomError` instances must carry a numeric `statusCode`; any code that reads `error.statusCode` to build a response must verify its type first, not just its truthiness.
**What breaks if violated:** A config validation failure that would otherwise return a clean 4xx response instead crashes the request handler — a more severe failure than the one being reported, and initially misdiagnosed as "the crash" rather than "the actual missing env var."

---

## tax-calculator

### Issue 3: `validateAddress()` creates real Stripe Tax calculations that accumulate against monthly quota

**Problem:** `POST /taxCalculator/validateAddress` calls `stripe.tax.calculations.create()` with dummy values (`amount=100`, `tax_code=txcd_99999999`) to verify the address is valid. These are real, persisted Stripe Tax calculation objects — never committed or reversed, and they count against the Stripe Tax monthly calculation quota. High-frequency address validation (e.g., on every Express Checkout address change) can exhaust the quota, blocking real cart tax calculations.
**Root cause:** `tax-calculator/src/services/address.service.js:148` — Stripe Tax API provides no dry-run or ephemeral calculation endpoint; verification requires a real calculation.
**Rule:** Any Stripe API call that creates a persisted resource must be documented and its quota impact understood. See `../../context/failure-modes.md — Stripe API: Address validation phantom calculations accumulate`.

### Issue 4: `TAX_CODE_CATEGORY_MAPPING_JSON` is not in `envValidators` — startup succeeds with empty mapping

**Problem:** `TAX_CODE_CATEGORY_MAPPING_JSON` is absent from the `envValidators` array. If the env var is missing or malformed, `tax-calculator/src/config/taxCodeMapping.config.js:24` silently defaults to `{ categories: [] }`. Every line item then throws `TaxCodeNotFoundError`, blocking tax calculation on every cart update — but only at runtime, not at deploy time. The env var IS validated at post-deploy via `validateTaxCodeMapping`, but a connector restart loses that post-deploy validation.
**Root cause:** `tax-calculator/src/config/taxCodeMapping.config.js:24` — silent empty fallback; `tax-calculator/src/validators/env-var.validators.js` — variable absent from the validation list.
**Rule:** Configuration that is functionally required must be validated at startup, not only at post-deploy.

### Issue 5: `Promise.allSettled()` in the orchestrator silently drops partial calculation failures

**Problem:** Parallel Stripe Tax calculation calls use `Promise.allSettled()`. When some calculations fail (e.g., some shipping methods fail, or one ship-from group fails), the failures are logged as warnings and silently omitted from the result. The cart receives partial tax data — some line items taxed, others not — with no indication of which items are untaxed.
**Root cause:** `tax-calculator/src/services/tax-orchestrator.service.js:535` — failed settlements are filtered out before building update actions.
**Rule:** Partial tax calculation failures must be surfaced to the caller, not silently omitted — a cart with some items untaxed is worse than a cart that fails to update (the latter triggers a client retry).

### Issue 6: No authentication on `/taxCalculator` or `/taxCalculator/validateAddress` — any caller can trigger Stripe Tax API calls

**Problem:** Neither route has any authentication middleware. Any HTTP caller — not just CT API Extensions — can trigger real Stripe Tax calculations, consuming monthly calculation quota and generating phantom Stripe Tax records.
**Root cause:** `tax-calculator/src/routes/tax.calculator.route.js`, `tax-calculator/src/routes/address.validation.route.js` — no auth middleware registered on either router.
**Rule:** Any endpoint that triggers paid external API calls must have authentication at the HTTP layer. CT API Extension delivery provides no built-in shared secret.

### Issue 7 (Resolved 2026-07-28): Shipping `tax_behavior` was hardcoded to `'exclusive'` regardless of `TAX_BEHAVIOR_COUNTRY_MAPPING` config

**Problem:** The shipping line item always used `tax_behavior: 'exclusive'` regardless of the `TAX_BEHAVIOR_COUNTRY_MAPPING` configuration. For countries configured with `inclusive` tax behavior, product line items received inclusive tax treatment but shipping costs received exclusive treatment — an inconsistency visible in the final cart totals.
**Root cause:** `tax-calculator/src/services/tax-orchestrator.service.js:278,398` (pre-fix line numbers) — `'exclusive'` hardcoded for shipping; country-based behavior lookup not applied to the shipping item.
**Rule:** Shipping tax behavior must follow the same country-based config as line items.
**Fix applied:** Both `createSingleRequestForGroup()` and `populateRequestWithLineItems()` now read the same resolved `taxBehaviors` map used for line items and apply it to `shipping_cost.tax_behavior`, omitting the field entirely (letting Stripe use its own default) when no behavior was determined. See `../context/business-rules/tax-calculation.md` Rule 6 and its regression tests.

### Issue 8: Tax code resolution strategies 2–4 commented out — only Strategy 1 (category custom type) is active

**Problem:** `tax-code.service.js` documents five resolution strategies in the class comment, but strategies 2–4 are commented out in `getTaxCodeForProduct()`: Strategy 2 (product custom field), Strategy 3 (category mapping JSON), Strategy 4 (parent category traversal). The function goes from Strategy 1 directly to Strategy 5 (throw `TaxCodeNotFoundError`). The `TAX_CODE_CATEGORY_MAPPING_JSON` env var has no effect on line item resolution as a result.
**Root cause:** `tax-calculator/src/services/tax-code.service.js:44-62` — strategies commented out with no documentation of why.
**Rule:** Every product that participates in tax calculation must have the `connectorStripeTax_TaxCode` custom type field set directly on its CT category. Parent-category fallback and product-level custom fields do not work today.
**Implementation note:** To implement: uncomment and wire strategies 2–4. Evaluate whether `TAX_CODE_CATEGORY_MAPPING_JSON` should power strategy 3 at runtime (currently used only for post-deploy validation).

### Issue 9: `HTTP_STATUS_SUCCESS_ACCEPTED` constant has value `200`, not `202`

**Problem:** The constant `HTTP_STATUS_SUCCESS_ACCEPTED` is named to imply HTTP 202 but its value is `200`. `tax-calculator` therefore returns HTTP 200 (not 202) on success. `order-syncer` has a separate constants file where the same constant is correctly `202` — a maintenance risk: a developer reading the constant name would assume 202 is returned and write incorrect assertions.
**Root cause:** `tax-calculator/src/constants/http.status.constants.js:1` — constant name/value mismatch.
**Rule:** Constant names must match their values. No runtime impact today (CT API Extensions accept any 2xx) — cosmetic inconsistency only.

### Issue 10: `countryMappingCache` not invalidated when `configCache` clears — stale tax behavior after config reload

**Problem:** `countryMappingCache` is a separate in-memory cache from the main `configCache`. When `configCache` is cleared (e.g., via cache TTL expiry), `countryMappingCache` is not cleared. The service continues to return stale country → tax behavior mappings until the country cache independently expires or the process restarts.
**Root cause:** `tax-calculator/src/services/tax-behavior.service.js:109` — independent cache lifecycle not coordinated with `configCache`.
**Rule:** All caches that share the same configuration source must be invalidated together — a config change to `TAX_BEHAVIOR_COUNTRY_MAPPING` will not take effect on running instances until `countryMappingCache` also clears.

### Issue 11: `StripeTaxValidator.autoPopulateDefaults()` mutates `process.env` at runtime

**Problem:** `autoPopulateDefaults()` sets `process.env.TAX_CODE_DEFAULT` when the env var is absent. This mutates the Node.js process environment at runtime, affecting all code that reads `process.env.TAX_CODE_DEFAULT` after this call. In containerized environments where the process is shared across requests, this mutation persists for the container's lifetime.
**Root cause:** `tax-calculator/src/validators/stripeTaxValidator.js:79` — direct `process.env` mutation used as a default-setting mechanism.
**Rule:** Runtime defaults must be applied in the application config layer, not by mutating `process.env` — unpredictable in multi-instance or shared-process environments.

### Issue 12: `findFirstTaxCodeInHierarchy()` is dead code — never called

**Problem:** Defined but never called from `getTaxCodeForProduct()` or any other code path — presumably part of the category traversal strategy (Strategy 4) commented out in Issue 8.
**Root cause:** `tax-calculator/src/services/tax-code.service.js:113`.
**Rule:** Dead code must be removed or explicitly marked as reserved for future use with a TODO referencing the tracking issue.

### Issue 13: `TaxErrorHandlerService.isStripeError()` only matches 2 of 7 Stripe SDK error types — unmatched errors leak raw Stripe objects to the caller

**Problem:** `isStripeError()` matches only `StripeInvalidRequestError` and `StripeAPIError`. The Stripe SDK also surfaces `StripeConnectionError`, `StripeAuthenticationError`, `StripeRateLimitError`, `StripePermissionError`, and `StripeCardError`. Unmatched Stripe errors fall through to `handleOtherErrors()`, which calls `response.status(error.statusCode).send(error)` — returning the raw Stripe error object as the HTTP body, which is not CT-compatible and may expose internal Stripe API context to the caller.
**Root cause:** `tax-calculator/src/services/tax-error-handler.service.js:99` — `isStripeError()` check is incomplete.
**Rule:** All error types surfaced by an external SDK must be handled explicitly. Raw external error objects must never be returned as HTTP response bodies. Use `error instanceof stripe.errors.StripeError` as the base check, then specialize by subtype.

### Issue 14: `buildCombinedResult()` hardcodes `'USD'` as fallback currency

**Problem:** `buildCombinedResult()` uses `'USD'` as the fallback when no currency was captured from any calculation. For carts operating in EUR or GBP where the first calculation may not set `firstCurrency`, `setCartTotalTax` is emitted with `currencyCode: 'USD'`, causing CT to reject the update with a currency mismatch error.
**Root cause:** `tax-calculator/src/services/update-action.service.js:181` — hardcoded string fallback instead of reading `cart.totalPrice.currencyCode`, already available in the call chain.
**Rule:** Currency must always be derived from the cart or from Stripe's response — hardcoded currency defaults are not acceptable. See hub global coding rules — monetary amounts.

### Issue 15: Failed-calculation diagnostic log reports the wrong request index

**Problem:** `failed.map((f, index) => ({ requestIndex: index, ... }))` maps over the already-filtered failures array. If requests 0 and 2 fail and request 1 succeeds, the log reports `requestIndex: 0` and `requestIndex: 1` instead of `0` and `2`. Operators investigating a partial-failure incident cannot identify which ship-from group or shipping method actually failed.
**Root cause:** `tax-calculator/src/services/tax-orchestrator.service.js:557` — `.map()` resets indices on the filtered array; original request indices are not preserved.
**Rule:** Diagnostic logs must reference the original position of the failed item in the request array, not its position in a filtered output.

### Issue 16: `findBreakdownByMostCommonTaxType()` majority-vote heuristic can assign the wrong tax rate in mixed-exemption carts

**Problem:** When Strategy 1 (direct match) fails to find a tax breakdown for a line item, the fallback selects the most frequently occurring `tax_type` across all breakdowns in the calculation. In a cart that mixes taxable and tax-exempt items, this heuristic may assign the taxable rate to an exempt item or vice versa. The method does not log which item triggered the fallback, making it invisible in production.
**Root cause:** `tax-calculator/src/services/update-action.service.js:773` — heuristic fallback with no observability and no correctness guarantee for mixed-exemption catalogs.
**Rule:** Tax rate assignment must be deterministic and traceable. Add a `logger.warn` when the heuristic fires, including `cartId`, `lineItemId`, and the selected `tax_type` — this does not fix correctness but makes the issue visible in production logs.

---

## order-syncer

### Issue 17: `createTaxTransactions()` has no per-iteration try/catch — first failure aborts all remaining transaction sync

**Problem:** `createTaxTransactions()` loops over all calculation references calling `tax.transactions.createFromCalculation()` without a per-iteration try/catch. The first failure throws and exits the loop. No transactions are committed for any subsequent calculation references. The outer `syncHandler` catches the error and returns HTTP 202 to Pub/Sub (see Issue 18), which discards the message permanently.
**Root cause:** `order-syncer/src/extensions/stripe/clients/client.js:70` — no per-iteration error handling in the transaction creation loop.
**Rule:** Each transaction commit must be independently fault-tolerant. Partial failures should be collected and reported, not abort the entire sync. See `../../context/failure-modes.md — Stripe Tax API: Order sync transaction commit failure`.

### Issue 18: `CustomError(202, ...)` used for error responses — Pub/Sub treats 202 as success and discards the message

**Problem:** `updateOrderTaxTxn()` at `order-syncer/src/clients/update.client.js:33` and `getOrderWithPaymentInfo()` / `getOrder()` at `order-syncer/src/clients/query.client.js:19,38` throw `CustomError(HTTP_STATUS_SUCCESS_ACCEPTED, ...)`. HTTP 202 is a success code — Pub/Sub acknowledges and discards the message. A failed CT order update or failed CT order fetch causes permanent data loss with no retry. `order-syncer/src/controllers/sync.controller.js:38` also uses 202 for missing-data cases.
**Root cause:** `order-syncer/src/clients/update.client.js:33`, `order-syncer/src/clients/query.client.js:19,38`, `order-syncer/src/controllers/sync.controller.js:38` — `HTTP_STATUS_SUCCESS_ACCEPTED` (202) used for error cases.
**Rule:** Error responses to Pub/Sub must use 4xx or 5xx to trigger redelivery. 2xx = acknowledged and discarded. See `../../context/known-issues.md` cross-cutting Issue on this pattern, `../../context/failure-modes.md — CT Platform API: Order update failure during tax sync`.

### Issue 19: Existing-transaction lookup extracts an ID by regex-parsing the Stripe error message string

**Problem:** When `tax.transactions.createFromCalculation()` fails with a "already exists" error (duplicate transaction), the code extracts the existing transaction ID by applying the regex `tax_\w+` to the error message string. Stripe may change its error message format in any API version update, silently breaking the deduplication logic. When the regex fails to match, the transaction ID is `undefined`, the CT order update writes an undefined reference, and the Stripe Tax transaction becomes unreachable from CT.
**Root cause:** `order-syncer/src/extensions/stripe/clients/client.js:38` — error message string parsing used as a workaround because Stripe provides no "find transaction by calculation ID" endpoint.
**Rule:** Error handling must not depend on specific error message text from external APIs. Use error codes, types, or dedicated lookup endpoints. See `../CLAUDE.md` → What Claude Must Never Do.

### Issue 20: `readConfiguration()` throws a string statusCode, breaking the error-response path

**Problem:** `readConfiguration()` throws `CustomError` with a **string** statusCode (`'InvalidEnvironmentVariablesError'`) instead of a number. `error.middleware.js:13` checks `typeof error.statusCode === 'number'` (fails, falls to generic 500), but `sync.controller.js:58` does `response.status(err.statusCode)` directly — calling `response.status('InvalidEnvironmentVariablesError')`, which Express/Node rejects as an invalid status code, throwing an unhandled error while trying to respond instead of returning a clean error.
**Root cause:** `order-syncer/src/utils/config.util.js:24`, `order-syncer/src/controllers/sync.controller.js:58`.
**Rule:** All `CustomError` instances must carry a numeric `statusCode`.

### Issue 21: `order-syncer`'s own custom type omits the field it depends on from `tax-calculator`

**Problem:** `order-syncer`'s own custom type definition (`customTypes.js`) only declares the `TRANSACTION_REFERENCES` field. The `CALCULATION_REFERENCES` field it reads (`sync.controller.js:49,77`) is created only by `tax-calculator`'s post-deploy, against the same custom-type key. If `tax-calculator` has not been deployed (or is undeployed independently), this field is simply absent and every order is silently treated as "no calculation references, skipping" — no error surfaced. This is the practical consequence of Issue 1's data-contract fragility, not a separate root cause.
**Root cause:** `order-syncer/src/connectors/customTypes.js:9-39`; `order-syncer/src/controllers/sync.controller.js:77-84`.
**Rule:** `order-syncer` cannot be deployed usefully without `tax-calculator` also being deployed to the same CT project — this dependency is not documented anywhere in the current adopter-facing docs.

### Issue 22: Pre-undeploy custom-type cleanup errors are swallowed, reported as success

**Problem:** `deleteCustomTypes` catches cleanup errors during pre-undeploy and only logs them — it does not re-throw, so `pre-undeploy.js`'s `run()` reports success (`exitCode` stays 0) even if custom type cleanup actually failed.
**Root cause:** `order-syncer/src/connectors/action.js:184-200`.
**Rule:** Undeploy cleanup failures should be surfaced, not silently reported as success.

### Issue 23: PaymentIntent metadata annotation errors are fully swallowed

**Problem:** `updatePaymentIntentMetadata` swallows all errors (warn-log only); a failure here is invisible to the caller and does not affect the 204 response, so PaymentIntent metadata can silently go out of sync with no retry or alert.
**Root cause:** `order-syncer/src/extensions/stripe/clients/client.js:83-93`.
**Rule:** Best-effort side effects should still surface a signal (metric/log line searchable in production) distinguishable from full success.

### Issue 24: No startup-time environment validation

**Problem:** `readConfiguration()` is only invoked lazily on the first inbound Pub/Sub push (via `createApiRoot()`) — the service accepts traffic and appears healthy even with invalid/missing CT or Stripe credentials until the first real order arrives.
**Root cause:** `order-syncer/src/utils/config.util.js:11-32`; no call site in `order-syncer/src/index.js`.
**Rule:** Required credentials must be validated at startup, not lazily on first use.

### Issue 25 (low): Misc code-quality gaps

- Unsafe property access `order?.paymentInfo?.payments[0]?.obj?.interfaceId` — `.payments` array access itself isn't optional-chained (`sync.controller.js:50,78`); throws if `paymentInfo` exists without a `payments` array (caught upstream, results in a generic 500, not a crash).
- No verification of the inbound Pub/Sub push token/OIDC identity anywhere in the codebase — the endpoint's protection (if any) must come entirely from infrastructure (private ingress, GCP push subscription auth), not this module's code.
- `package.json` name is `"order-syncher"` (typo), inconsistent with the module/directory name `order-syncer`.

---

### Issue 26 (Resolved 2026-09-17): `cart.country` overrode the delivery address as the Stripe Tax destination

**Problem:** The address sent to Stripe Tax was assembled from two different cart fields — street, city and postal code from the delivery address, but `country` from `cart.country`. Stripe treats `customer_details.address` as the transaction destination, so that country selected the tax jurisdiction. `cart.country` is a price-selection field and is shopper-controlled (`setCountry` is accepted from customer and anonymous tokens on the My Carts API), so a shopper could move the sale to another jurisdiction while the goods still went to the original address and receive an authoritative zero-tax or wrong-tax total. In `ExternalAmount` mode that total is what the cart becomes payable at, and the retained calculation reference is what `order-syncer` turns into the compliance transaction.

Two further consequences of the same root cause:

- `tax-behavior.service.js` resolved inclusive/exclusive from the same field, so where a merchant mapped two markets to different behaviors a shopper could force `inclusive` on a price published as exclusive. Stripe keeps the customer's total constant under inclusive behavior, so the merchant remits the tax from their own margin.
- In Multiple shipping mode **every** destination received `cart.country`. A cart legitimately delivering to two countries was taxed as if both went to one — a wrong calculation with no attacker involved.

**Root cause:** `tax-calculator/src/services/tax-orchestrator.service.js` → `extractCustomerAddress()` (pre-fix line 517) returned `country: cart.country` alongside delivery-address fields, and both callers labelled the result `address_source: 'shipping'`. `tax-behavior.service.js:66` read the same field. `validators/address.validator.js` → `validateCartAddress()` repeated the mix, though it is not reachable from the extension path.

**Rule:** The tax destination is the delivery address, entirely. `cart.country` selects prices and never determines tax — it survives only as the country of an otherwise empty address, for a cart with no delivery address yet. A delivery address that exists must carry its own country; a partial one is rejected, never completed from `cart.country`. See `decisions/adr-007-tax-destination-country.md`.

**Reported as:** CTT-002 (external), SB3-218 (internal). CWE-840, CVSS:3.0/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:H/A:N — 6.5 Medium.

**Verified against live Stripe Tax in test mode 2026-09-17**, same cart, `cart.country = "US"` throughout: delivery to the US produced `US` and 29,791 exclusive; to Berlin (registered) `DE` and 57,782 inclusive — 19% German VAT; to Madrid (not registered) `ES` and zero. That last row is the reported mechanism seen directly — a destination with no active registration returns zero tax, which is what the attack manufactured by sending a false country.

**Carts calculated before the fix:** a calculation now records its destination (`connectorStripeTax_destinationCountry`) and is only re-applied while that still matches the cart. One stored earlier records none, so it is recalculated rather than replayed. No migration is needed.

**Still open, tracked separately:** re-apply does not otherwise revalidate that a stored calculation matches the cart — a change of city, postal code or street within the same country still replays. And `validateCartAddress()` remains unreachable from the extension path; activating it changes which carts are rejected.
