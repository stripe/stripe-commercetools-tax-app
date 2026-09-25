# Failure Modes — ct-stripe-tax

Operational failure scenarios for both modules of this connector (`tax-calculator`, `order-syncer`). Cross-cutting scenarios shared with the payment connectors (general Stripe/CT unavailability) live in `../../context/failure-modes.md`.

---

## Stripe Tax API — Tax calculation request failure (tax-calculator)

**Trigger:** `tax.calculations.create()` fails for one or more parallel calculations during cart update
**Current behavior on failure:** `Promise.allSettled()` collects results; failed calculations are logged as warnings and silently omitted from the result. If ALL calculations fail, an error is thrown to the CT API Extension and CT returns an error to the caller.
**Blast radius:** When partial failures occur, the cart receives incomplete tax data — some line items taxed, others not. Merchants cannot tell which items are untaxed. This is silent data corruption.
**File:** `tax-calculator/src/services/tax-orchestrator.service.js:535,550-567`
**Recommendation:** Treat any calculation failure as a full failure — return an error to CT rather than partial results.

---

## Stripe API — Address validation phantom calculations accumulate (tax-calculator)

**Trigger:** `POST /taxCalculator/validateAddress` called repeatedly (e.g., on every Express Checkout address change)
**Current behavior on failure:** Each call creates a real Stripe Tax calculation object (never committed). Calculations accumulate in the Stripe account. Stripe Tax has monthly calculation quotas; excessive address validation calls may exhaust them before real cart calculations can be made.
**Blast radius:** Calculation quota exhaustion → all cart tax calculations fail until the next month (or quota increase). Stripe does not distinguish phantom address-verification calculations from real cart calculations in the quota.
**File:** `tax-calculator/src/services/address.service.js:148`
**Recommendation:** Consider rate-limiting the address validation endpoint (see `context/known-issues.md` Issue 6 — no auth, documented but rate limiting not implemented), or investigate whether Stripe Tax provides a dry-run or validation-only API.

---

## Stripe Tax API — Order sync transaction commit failure (order-syncer)

**Trigger:** `tax.transactions.createFromCalculation()` fails during order sync in the multi-calculation path
**Current behavior on failure:** In the multi-calc path, no try/catch exists per iteration — the first failure aborts the loop. No transactions are committed. The sync controller catches the outer error and returns HTTP 202 (a success code) to Pub/Sub, which discards the message. The order is permanently left without Stripe Tax transaction references.
**Blast radius:** Stripe Tax reporting is incomplete — the order shows no transaction in Stripe. The CT order has no `connectorStripeTax_transactionReferences`. Manual intervention required.
**File:** `order-syncer/src/extensions/stripe/clients/client.js:55-75` (multi-calc path); `order-syncer/src/controllers/sync.controller.js` (202 response)
**Recommendation:** Use 500 (not 202) for errors so Pub/Sub retries delivery. Add per-iteration try/catch to handle partial failures gracefully.

---

## CT Platform API — Order update failure during tax sync (order-syncer)

**Trigger:** `updateOrderTaxTxn()` fails after Stripe Tax transaction was successfully committed
**Current behavior on failure:** Error caught; `CustomError(202, ...)` thrown. HTTP 202 returned to Pub/Sub. Pub/Sub treats this as success and discards the message. The Stripe Tax transaction exists in Stripe but the CT order has no `connectorStripeTax_transactionReferences` field.
**Blast radius:** Stripe Tax reporting and CT order data are permanently out of sync. Re-processing is impossible (Stripe will reject duplicate `createFromCalculation` for the same calculation ID).
**File:** `order-syncer/src/clients/update.client.js:13-36`
**Recommendation:** Return HTTP 500 (not 202) on CT update failure so Pub/Sub retries. On retry, the duplicate-transaction error from Stripe is already handled by the `getTransactionFromTaxCalculation` regex parse (see `context/known-issues.md` Issue 19 for why that parse itself is fragile).
