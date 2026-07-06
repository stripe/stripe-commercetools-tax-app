# Tax Transaction Sync

Rules governing how order-syncer turns a commercetools OrderCreated event into committed Stripe tax transactions and writes them back. These document what the code actually does, including behavior that is fragile or risky.

## Rule 1: Only OrderCreated events carrying calculation references are processed

**What:** An inbound Pub/Sub message is processed only when it is an `OrderCreated` message type and the referenced CT order has the custom field `connectorStripeTax_calculationReferences`. `ResourceCreated` notifications and messages of any other type are skipped, and an order without that custom field is skipped silently.
**Why:** This module commits pre-existing Stripe tax calculations; it has no work to do for other event types or for orders that were never tax-calculated (the calculation field is created upstream by `tax-calculator`, not by this module).
**Invariant:** No Stripe `tax.transactions.createFromCalculation` call is made unless the message is `OrderCreated` and the order exposes `connectorStripeTax_calculationReferences`.
**Implementation:** src/constants/connectors.constants.js:1-2 (type filter); src/controllers/sync.controller.js:49,77 (reads the calculation-reference field); src/connectors/customTypes.js:23-38 (this module does not define that field).
**Closure criterion:** `grep -n "OrderCreated" src/constants/connectors.constants.js` shows the accepted-type filter, and `grep -n "connectorStripeTax_calculationReferences" src/controllers/sync.controller.js` shows the guarded read.
**What breaks if violated:** Processing non-OrderCreated events, or orders without calculation references, would attempt to commit non-existent Stripe calculations — producing errors or committing the wrong/no tax transaction.

---

## Rule 2: Idempotency on duplicate commit relies on regex-recovering the existing transaction ID (fragile)

**What:** When Stripe rejects a `tax.transactions.createFromCalculation` call because the calculation was already committed, the single-calc path swallows the error and recovers the already-existing transaction ID by matching the regex `/tax transaction (tax_\w+)/` against the Stripe error message text. This is the actual idempotency mechanism — there is no CT-side record of prior commits consulted first.
**Why:** Retried Pub/Sub deliveries of the same OrderCreated event must not create duplicate tax transactions; the code attempts to make re-commit a no-op by re-deriving the prior ID from the error.
**Invariant:** On a duplicate commit, the transaction ID written back equals whatever the regex captures from Stripe's error message — and if the regex fails to match, that ID is `undefined` while the order is still treated as synced.
**Implementation:** src/extensions/stripe/clients/client.js:29-36 (create + swallow), :38 (regex recovery).
**Closure criterion:** `grep -n "tax transaction (tax_" src/extensions/stripe/clients/client.js` shows the recovery regex still in use.
**What breaks if violated / if the regex fails:** If Stripe changes its error wording, the captured ID becomes `undefined`; the order is marked synced with no valid transaction reference, breaking tax compliance with no error surfaced. (See known-issues Issue 1.)

---

## Rule 3: commercetools is the source of truth for order state; CT failures are acknowledged as 202

**What:** The commerce platform (commercetools) holds the authoritative order state; this module reads the order and writes transaction references back to it. When a CT getOrder or update call fails, the client re-throws a `CustomError` with `statusCode 202` and the controller returns HTTP 202 to Pub/Sub. This is the code's actual, deliberate behavior even though it acknowledges a failure as success.
**Why:** CT is the system of record; the connector never recomputes or reconciles order state locally. The 202-on-failure behavior is (inferred) intended to avoid Pub/Sub redelivery storms — see ADR-001.
**Invariant:** A CT read/write failure during sync results in an HTTP 202 acknowledgment to Pub/Sub (message not retried), and the connector never mutates order state other than writing the `connectorStripeTax_transactionReferences` custom field.
**Implementation:** src/clients/query.client.js:20 and src/clients/update.client.js:34 (re-throw as 202); src/controllers/sync.controller.js:58 (returns the status); src/clients/update.client.js:21-35 (the only order mutation).
**Closure criterion:** `grep -n "202" src/clients/query.client.js src/clients/update.client.js` shows the CustomError statusCode mapping.
**What breaks if violated:** Returning 202 on a genuine CT failure means the tax sync for that order is silently dropped (message acknowledged, never retried). This is a known risk documented in known-issues Issue 2 — treat it as a hazard, not a pattern to extend.
