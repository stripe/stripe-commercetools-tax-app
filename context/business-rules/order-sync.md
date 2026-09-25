# Business Rule: Order Synchronization

## Overview

After a CT order is created, the order-syncer converts the Stripe Tax calculation into a Stripe Tax transaction. This records the completed sale in Stripe's tax reporting system. The sync is asynchronous — it does not block checkout.

---

## Rule 1: Tax transactions are created from the calculations, not from scratch

**What:** The order-syncer calls `stripe.tax.transactions.createFromCalculation()` once per Stripe calculation reference stored on the order. The references are read from the order's custom-field set `connectorStripeTax_calculationReferences` (a `Set of String`, because a single cart can produce multiple Stripe calculations — e.g., one per shipping method or per ship-from group). It does not re-send line items or addresses to Stripe.

**Why:** The calculation was already made and validated at checkout time. Creating the transaction from the calculation guarantees the transaction matches exactly what was shown to the customer. Recalculating would risk different tax amounts if rates changed between checkout and order creation.

**Invariant:** Each transaction must always be created from a calculation ID, never independently. If the references field is missing or empty, the sync skips with a warning — it never proceeds without an ID.

**Implementation:** `sync.controller.js` → `syncOrderToTaxProvider()` reads `order.custom.fields.connectorStripeTax_calculationReferences` → `extensions/stripe/clients/client.js` → `getTransactionFromTaxCalculation()` (single ref) or `createTaxTransactions()` (multiple refs) → both wrap `stripe.tax.transactions.createFromCalculation()`.

**What breaks if violated:** If tax is recalculated at order time instead of using the checkout calculation, the amounts may differ from what the customer was shown and what was charged. This creates a compliance discrepancy.

---

## Rule 2: Missing calculation references skip the sync (no order impact)

**What:** If `connectorStripeTax_calculationReferences` is missing or an empty array on the order's custom fields, `syncOrderToTaxProvider()` logs `Order ${orderId} has no calculation references. Skipping.` and returns. The CT order is not modified.

**Why:** Order sync is asynchronous and must not block or reverse the order. If the references are missing (configuration error or race condition), the order should still stand — the tax reporting gap is a separate concern.

**Invariant:** Never fail, roll back, or modify the CT order because of a sync failure. Log a warning for investigation, but the order lifecycle is independent of Stripe Tax reporting.

**Implementation:** `sync.controller.js` → `syncOrderToTaxProvider()` — `if (calcRefs.length === 0) { logger.warn(...); return; }`.

**What breaks if violated:** If sync failure reversed or canceled the CT order, customers who successfully paid would have their orders voided because of a backend reporting issue.

---

## Rule 3: Transaction references are stored on the order, plus PaymentIntent metadata

**What:** After each `createFromCalculation()` succeeds, the resulting Stripe transaction IDs (`tax_xxx`) are written to the CT order's custom field `connectorStripeTax_transactionReferences` (a `Set of String`). Additionally, when the order has an attached PaymentIntent, the same transaction IDs are joined with a comma+space separator and written to the PaymentIntent's `metadata.tax_transactions` field via `paymentIntents.update()`.

**Why:** The order is the long-lived record of a sale. Storing the transaction IDs on the order makes them auditable from the CT console. Mirroring them on the PaymentIntent makes them visible in Stripe Dashboard alongside the payment.

**Invariant:** Always update the CT order, not the CT cart, with transaction IDs. PaymentIntent metadata sync is best-effort: a failure is logged as a warning and does not abort the order update.

**Implementation:**
- CT order update: `clients/update.client.js` → `updateOrderTaxTxn()` — emits `setCustomField` for `connectorStripeTax_transactionReferences`.
- PaymentIntent metadata: `extensions/stripe/clients/client.js` → `updatePaymentIntentMetadata()`.

**What breaks if violated:** The transaction IDs are stored in the wrong place, making them impossible to retrieve when auditing an order in the CT console or reconciling against Stripe Dashboard.

---

## Rule 4: Pub/Sub message must be decoded before processing

**What:** CT Pub/Sub messages arrive as base64-encoded JSON. The order-syncer decodes the message body before reading the order ID and resource version.

**Why:** This is the Pub/Sub message format — CT encodes the payload in base64 when publishing to Google Cloud Pub/Sub.

**Invariant:** Always decode the base64 body before parsing JSON. Never attempt to parse the raw message body as JSON directly.

**Implementation:** `utils/decoder.util.js` → `decodeToJson()` runs `Buffer.from(encodedMessageBody, 'base64').toString().trim()` then `JSON.parse()`. `sync.controller.js` calls `decodeToJson(request.body.message.data)` before validation.

**What breaks if violated:** JSON parse fails on the base64 string, causing the sync to error on every message.

---

## Rule 5: Order-syncer returns 204 on success; 202 for the "missing message data" guard, 500 otherwise

**What:** On a successful sync — including the "no calculation references, skipping" path — `/orderSyncer` returns HTTP 204 (No Content). When the controller detects a missing `request.body.message.data` it throws `CustomError(HTTP_STATUS_SUCCESS_ACCEPTED, ...)` (202), which the handler propagates so Pub/Sub treats it as ack. CT order-update failures bubble up via `update.client.js` throwing `CustomError(HTTP_STATUS_SUCCESS_ACCEPTED, ...)` (202) for the same reason. **All other errors — including JSON decode failures (`decodeToJson` throws `HTTP_STATUS_SERVER_ERROR`/500), Stripe failures, and any unexpected error — fall through to HTTP 500**, which Pub/Sub treats as a nack and retries.

**Why:** 2xx responses tell Google Cloud Pub/Sub the message was processed; 5xx triggers redelivery. The connector uses 202 for the two known "permanent failure" branches (missing message data, CT update API failures) so they don't retry forever, and 500 for everything else so transient issues get retried.

**Invariant:** Successful processing must return 2xx. Conditions that are permanently unrecoverable should return 2xx (via 202) so Pub/Sub stops redelivery. Decode failures currently return 500, so they will retry — this is intentional only if the JSON malformation is treated as transient; otherwise it is a known limitation.

**Implementation:** `sync.controller.js` — `try/catch` block; success path: `response.status(HTTP_STATUS_SUCCESS_NO_CONTENT).send()` (204); error path: returns `err.statusCode` if set (202 from `CustomError` or 500 from `decodeToJson`) or `HTTP_STATUS_SERVER_ERROR` (500). `update.client.js` throws `CustomError(HTTP_STATUS_SUCCESS_ACCEPTED, ...)` on CT API failures so they ack without retry. `utils/decoder.util.js` throws `CustomError(HTTP_STATUS_SERVER_ERROR, 'Invalid message format: unable to parse JSON')` on parse failure.

**What breaks if violated:** Transient errors that should retry (e.g., Stripe 5xx) get acked and the transaction is lost. Permanent errors that should ack (e.g., a permanently malformed payload) keep redelivering and flood logs — which is the current behavior for decode failures.
