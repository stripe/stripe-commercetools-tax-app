# order-syncer — Known Issues

Issues are ordered by severity (HIGH first). Every entry traces to a Known Gap in the module map.

## Issue 1: Existing tax-transaction ID recovered by regex-parsing a Stripe error message

**Problem:** On a duplicate calculation commit, the module extracts the already-existing tax transaction ID by running the regex `/tax transaction (tax_\w+)/` against the Stripe error message. If Stripe changes the error wording, the capture returns `undefined`, and the order is still marked synced with no transaction reference — a silent tax compliance/correctness failure.
**Root cause:** The recovery path parses free-text error copy instead of a stable field — src/extensions/stripe/clients/client.js:38.
**Rule:** Never rely on parsing a provider's human-readable error text to recover business-critical identifiers. Track committed transaction state in CT, or read the transaction ID from a structured Stripe field/response. If a transaction ID cannot be resolved, do not mark the order synced.
**Implementation note:** src/extensions/stripe/clients/client.js:29-38 (regex at :38).

---

## Issue 2: CT API failures acknowledged to Pub/Sub as HTTP 202 (silent sync loss)

**Problem:** CT order-fetch and order-update failures are re-thrown as `CustomError` with `statusCode 202`; the controller then returns HTTP 202 (Accepted) to Pub/Sub. Because 202 is a success acknowledgment, a genuine CT API failure is treated as processed and the message is not retried — the tax sync can be silently lost.
**Root cause:** Error mapping conflates a real failure with a benign "skip/ack" signal — src/clients/query.client.js:20, src/clients/update.client.js:34, src/controllers/sync.controller.js:58.
**Rule:** A genuine downstream (CT) failure must return a non-2xx status so Pub/Sub redelivers. Reserve 2xx acknowledgment for cases that are truly complete or intentionally skipped. Never acknowledge an unrecovered error as success.
**Implementation note:** src/clients/query.client.js:20, src/clients/update.client.js:34, src/controllers/sync.controller.js:58.

---

## Issue 3: Stripe PaymentIntent metadata update error swallowed

**Problem:** The `paymentIntents.update` call that writes `tax_transactions` metadata is wrapped in a try/catch that only warn-logs and does not re-throw. The PaymentIntent can end up missing its `tax_transactions` metadata with no failure surfaced to the caller or the message pipeline.
**Root cause:** Error is caught and downgraded to a warning — src/extensions/stripe/clients/client.js:91-93.
**Rule:** A failed write-back to a financial provider must be surfaced (re-thrown or recorded) so it can be retried or reconciled. Do not swallow provider write failures.
**Implementation note:** src/extensions/stripe/clients/client.js:85-89 (update), 91-93 (swallow).

---

## Issue 4: Read custom field is not created by this module

**Problem:** The controller reads the CT order custom field `connectorStripeTax_calculationReferences`, but this module's `ORDER_TAX_CUSTOM_TYPE` defines only `connectorStripeTax_transactionReferences`. The field being read is created elsewhere (assumed: the `tax-calculator` module). If that field is absent, the order is skipped silently.
**Root cause:** Cross-module implicit dependency on a field this module does not provision — src/controllers/sync.controller.js:49,77 read a field not in src/connectors/customTypes.js:23-38.
**Rule:** Document and verify the external ownership of `connectorStripeTax_calculationReferences`. Do not assume the read field exists; surface a skip reason rather than dropping the event silently.
**Implementation note:** src/controllers/sync.controller.js:49,77; src/connectors/customTypes.js:23-38.

---

## Issue 5: Only the first payment is used for the PaymentIntent ID

**Problem:** The controller reads `payments[0]` to obtain the PaymentIntent ID. Orders with multiple payments, or where the PaymentIntent is not on the first payment, will use the wrong PaymentIntent or none at all.
**Root cause:** Hardcoded array index assumes a single/first payment — src/controllers/sync.controller.js:50,78.
**Rule:** Resolve the PaymentIntent by matching the intended payment (e.g., payment method / interface id), not by positional index. Handle the multi-payment case explicitly.
**Implementation note:** src/controllers/sync.controller.js:50,78.

---

## Issue 6: errorMiddleware exported but never registered

**Problem:** `errorMiddleware` is defined and exported but is never registered on the Express app in `index.js`, so it is dead code — errors are not handled by it.
**Root cause:** Missing `app.use(errorMiddleware)` wiring — src/middlewares/error.middleware.js:11 exists, src/index.js does not register it.
**Rule:** Either register the error middleware as the last `app.use(...)` in `index.js` or remove it. Do not leave an unwired error handler that implies coverage it does not provide.
**Implementation note:** src/middlewares/error.middleware.js:11; src/index.js (no registration).

---

## Issue 7: CustomError statusCodes 204/202 used as control-flow skip signals

**Problem:** `doValidation` throws `CustomError` with `statusCode 204`/`202` to signal "skip". The controller catch returns those as the HTTP status with a JSON body. A 204 response with a body is non-conformant (204 must have no body).
**Root cause:** HTTP status codes reused as internal control-flow signals — src/validators/order-change.validators.js, src/controllers/sync.controller.js:58-60.
**Rule:** Represent skip/no-op decisions with an internal signal (a result type or sentinel), not by throwing HTTP status codes. When returning 204, send no body.
**Implementation note:** src/validators/order-change.validators.js; src/controllers/sync.controller.js:58-60.

---

## Issue 8: GCP subscription config read but never validated

**Problem:** `CONNECT_GCP_TOPIC_NAME` and `CONNECT_GCP_PROJECT_ID` are read in `post-deploy.js` but never validated. If absent, the CT subscription is created with an `undefined` topic and/or projectId, producing a broken subscription.
**Root cause:** No validation on required Pub/Sub destination config — src/connectors/post-deploy.js:16-17.
**Rule:** Validate `CONNECT_GCP_TOPIC_NAME` and `CONNECT_GCP_PROJECT_ID` before creating the subscription; fail fast with a clear error if either is missing.
**Implementation note:** src/connectors/post-deploy.js:16-17.

---

## Issue 9: Allowed CT region hardcoded as a fixed filter list

**Problem:** `CTP_REGION` is validated against a hardcoded allow-list of five regions (`us-central1.gcp`, `us-east-2.aws`, `europe-west1.gcp`, `eu-central-1.aws`, `australia-southeast1.gcp`). If commercetools adds a new supported region, this connector rejects a valid `CTP_REGION` until the code is updated and redeployed.
**Root cause:** A provider-supported set is baked into source as a non-configurable literal — src/validators/helpers.validator.js:129-135 (Configurable = No).
**Rule:** Region validity is owned by commercetools, not this connector. Prefer validating region format against the CT client's own region handling, or make the allow-list configurable, so a newly supported region does not require a code change.
**Implementation note:** src/validators/helpers.validator.js:129-135.

---

## Issue 10: Two independent config paths for the Stripe token

**Problem:** `readConfiguration()` validates `stripeApiToken`, while the Stripe client uses `loadConfig()` which independently re-reads `process.env.STRIPE_API_TOKEN` and throws its own error. Two sources of truth for the same credential can diverge in validation and error behavior.
**Root cause:** Duplicate config loading — src/utils/config.util.js:18 vs src/extensions/stripe/configurations/config.js:2.
**Rule:** Load and validate each credential once, in one place, and pass it through. Avoid re-reading `process.env` in a second module.
**Implementation note:** src/utils/config.util.js:18; src/extensions/stripe/configurations/config.js:2.

---

## Issue 11: Async fire-and-forget logger has an empty inner catch

**Problem:** The async logger's inner catch block is empty (`catch (e) {}`), so a logging failure is fully swallowed with no trace.
**Root cause:** Empty catch — src/utils/async-logger.utils.js:34-36.
**Rule:** Even for best-effort logging, avoid a fully empty catch; at minimum emit to a fallback (e.g., `console.error`) so logging failures are observable.
**Implementation note:** src/utils/async-logger.utils.js:34-36.

---

## Issue 12: Route name left as a TODO

**Problem:** A `TODO` comment ("Give a specific route name") remains at the route mount, indicating the route naming is unfinished/template-derived.
**Root cause:** Unresolved TODO — src/index.js:20.
**Rule:** Resolve or remove the TODO; give the route a deliberate, documented name.
**Implementation note:** src/index.js:20.

---

## Issue 13: Scaffolded middleware left as "Example only. Adapt on your own"

**Problem:** The auth and HTTP middleware option builders carry "Example only. Adapt on your own" comments, indicating template-scaffolded code that was never customized for this connector.
**Root cause:** Uncustomized scaffold — src/middlewares/auth.middleware.js:5, src/middlewares/http.middleware.js:5.
**Rule:** Review and adapt scaffolded middleware to this connector's actual requirements, or remove it. Do not ship example scaffolding as production behavior.
**Implementation note:** src/middlewares/auth.middleware.js:5; src/middlewares/http.middleware.js:5.

---

## Issue 14: package.json name is misspelled

**Problem:** The `package.json` `name` field is misspelled `"order-syncher"` (extra `h`).
**Root cause:** Typo in package metadata — package.json:2.
**Rule:** Correct the package name to `order-syncer`; verify nothing references the misspelled name before renaming.
**Implementation note:** package.json:2.
