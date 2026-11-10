# Business Rule: Order Synchronization

## Overview

After a CT order is created, the order-syncer converts the Stripe Tax calculation into a Stripe Tax transaction. This records the completed sale in Stripe's tax reporting system. The sync is asynchronous — it does not block checkout.

The field it reads is written by `tax-calculator`; that producer→consumer contract is in `calculation-reference-contract.md`.

---

## Rule 1: Tax transactions are created from the calculations, not from scratch

**What:** The order-syncer calls `stripe.tax.transactions.createFromCalculation()` once per Stripe calculation reference stored on the order. The references are read from the order's custom-field set `connectorStripeTax_calculationReferences` (a `Set of String`, because a single cart can produce multiple Stripe calculations — e.g., one per shipping method or per ship-from group). It does not re-send line items or addresses to Stripe.

**Why:** The calculation was already made and validated at checkout time. Creating the transaction from the calculation makes the transaction match exactly what was shown to the customer. Recalculating would risk different tax amounts if rates changed between checkout and order creation.

**Invariant:** Each transaction is created from a calculation ID, never independently. If the references field is missing or empty, the sync files nothing — it never proceeds without an ID — and acknowledges the message; it logs at **error** level when the order has a payment, at warning level otherwise (Rule 2).

**Implementation:** `sync.controller.js` → `syncOrderToTaxProvider()` reads `order.custom.fields.connectorStripeTax_calculationReferences` → binds each reference to the order (`partitionReferencesByOrderBinding`, Rule 11) → `extensions/stripe/clients/client.js` → `getTransactionFromTaxCalculation()` (single ref) or `createTaxTransactions()` (multiple refs) → both wrap `stripe.tax.transactions.createFromCalculation()`.

---

## Rule 2: Missing calculation references skip the sync (no order impact)

**What:** If `connectorStripeTax_calculationReferences` is missing or an empty array on the order's custom fields, `syncOrderToTaxProvider()` files nothing and returns. The CT order is not modified. The handler answers **204**. "Missing" covers absent, `null` and empty string, all coalesced to `[]`. It logs at **error** level when the first payment's `interfaceId` is set, and at warning level with no payment or an empty `interfaceId`.

**Why:** Order sync is asynchronous and must not block or reverse the order. If the references are missing, the order should still stand; tax reporting is a separate concern.

**Invariant:** Never fail, roll back, or modify the CT order because of a sync failure. Log for investigation — a warning for an unpaid order, an **error** for a paid one — but the order lifecycle is independent of Stripe Tax reporting.

**Implementation:** `sync.controller.js` → `syncOrderToTaxProvider()`; the only order write is the `setCustomField` of Rule 3, through `clients/update.client.js`.

---

## Rule 3: Transaction references are stored on the order, plus PaymentIntent metadata

**What:** After the provider step succeeds, the resulting Stripe transaction IDs (`tax_xxx`) are written to the CT order's custom field `connectorStripeTax_transactionReferences` (a `Set of String`). The write happens once per run, through a single `setCustomField`; the order is re-fetched first for its version. In the single-reference path the write happens only when an id was obtained; in the multi-reference path only if every call succeeded. Additionally, when the order has an attached PaymentIntent, the same transaction IDs are joined with a comma+space separator and written to the PaymentIntent's `metadata.tax_transactions` field via `paymentIntents.update()`.

**Why:** The order is the long-lived record of a sale. Storing the transaction IDs on the order makes them auditable from the CT console. Mirroring them on the PaymentIntent makes them visible in Stripe Dashboard alongside the payment.

**Invariant:** Always update the CT order, not the CT cart, with transaction IDs. PaymentIntent metadata sync is best-effort: a failure is logged as a warning and does not abort the order update.

**Implementation:**
- CT order update: `clients/update.client.js` → `updateOrderTaxTxn()` — emits `setCustomField` for `connectorStripeTax_transactionReferences`.
- PaymentIntent metadata: `extensions/stripe/clients/client.js` → `updatePaymentIntentMetadata()`.

---

## Rule 4: Pub/Sub message must be decoded before processing

**What:** CT Pub/Sub messages arrive as base64-encoded JSON. The order-syncer decodes the message body before reading the order ID and resource version.

**Why:** This is the Pub/Sub message format — CT encodes the payload in base64 when publishing to Google Cloud Pub/Sub.

**Invariant:** Always decode the base64 body before parsing JSON. Never attempt to parse the raw message body as JSON directly.

**Implementation:** `utils/decoder.util.js` → `decodeToJson()` runs `Buffer.from(encodedMessageBody, 'base64').toString().trim()` then `JSON.parse()`. `sync.controller.js` calls `decodeToJson(request.body.message.data)` before validation.

---

## Rule 5: Pub/Sub response status codes

**What:** The `/orderSyncer` endpoint responds:

- **204** on a successful sync — including the "no calculation references, skipping" path — and for a `ResourceCreated` notification.
- **202** for a missing `request.body.message.data`, and for a message filtered out by `type` or `typeId` (Rule 6).
- **500** for a message that does not decode; for a transient provider failure (no status, 409, 429 or 5xx) or a rejected API key (401 or 403) while binding a reference (Rule 11); and for any unexpected error. A rejected API key is logged at error level as a credentials failure.

Google Cloud Pub/Sub treats a 2xx response as acknowledgement and any other status as a nack that is redelivered.

**Why:** 2xx responses tell Google Cloud Pub/Sub the message was processed; 5xx triggers redelivery.

**Implementation:** `sync.controller.js` — `try/catch` block; success path `response.status(HTTP_STATUS_SUCCESS_NO_CONTENT).send()` (204). Note `HTTP_STATUS_SUCCESS_ACCEPTED` is **202** here and **200** in `tax-calculator` (`order-syncer/src/constants/http.status.constants.js` · `tax-calculator/src/constants/http.status.constants.js`); read the value, not the name.

---

## Rule 6: Only an `OrderCreated` message about an order with an id is processed

**What:** A delivered message is acted on only when all of these hold:
- its decoded body is truthy;
- `notificationType` is not `'ResourceCreated'`;
- `type` is in `['OrderCreated']`;
- `resource.typeId === 'order'`;
- `resource.id` is truthy.

| Condition | Response |
| --- | --- |
| `!messageBody` | 202 |
| `notificationType === 'ResourceCreated'` | 204 |
| wrong `type` | 202 |
| wrong `typeId`, or falsy id | 202 |
| no `message.data` at all | 202 |
| data that does not decode to JSON | **500** |

**Why:** The subscription delivers `OrderCreated` only (`deploy-lifecycle.md` Rule 5, *`order-syncer` replaces its subscription by deleting it first, then subscribes to `OrderCreated` only*). The checks guard against the subscription-confirmation message and against malformed deliveries.

**Implementation:** `order-syncer/src/validators/order-change.validators.js`.

---

## Rule 9: PaymentIntent metadata is updated best-effort with the first payment's `interfaceId`

**What:** The id is taken from `paymentInfo.payments[0].obj.interfaceId`. It is sent as transaction metadata, and, when truthy **and** at least one transaction exists, used to overwrite the payment intent's `tax_transactions` metadata with the joined ids. When there is no payment or the `interfaceId` is empty, the metadata step is skipped.

**Why:** It links the payment to the committed tax.

**Invariant:** The update runs only `if (paymentIntentId && transactions.length > 0)`; a failed update is logged at warning level and the sync still returns 204.

**Implementation:** `order-syncer/src/controllers/sync.controller.js`; `order-syncer/src/extensions/stripe/clients/client.js` → `updatePaymentIntentMetadata()`.

---

## Rule 10: A transaction's reference is the calculation id

**What:**
- `reference` is set to the **calculation id**, not to the order id or order number.
- The order id travels only in metadata (`ct_order_id`).

**Invariant:** `reference: calculationReference`; `ct_order_id: orderId` (`order-syncer/src/extensions/stripe/clients/client.js`).

---

## Rule 11: A reference is filed only when the calculation it names belongs to this order (filing-time binding)

**What:** `syncOrderToTaxProvider` partitions the stored references through `partitionReferencesByOrderBinding` before filing. Per reference, the calculation is retrieved (`expand: ['line_items']`) and kept **only** when:
- **every** line item carries the order's cart id in `metadata.cartId` (`order.cart.id`); and
- the calculation's own `customer_details.address` has the same jurisdiction key (country + state + city + postal code, normalized) as the destination `tax-calculator` sent for it, rebuilt from the order (`orderDestinationForCalculation`):
  - `Single`: `order.shippingAddress`;
  - `Multiple`: the address of the shipping method named by the `shippingKey` that `tax-calculator` stamps on every line item. A calculation whose line items carry no key, different keys, or a key the order has no shipping entry for was made for none of this order's shipments and is **refused** (`shipping-key-missing`, `shipping-key-mixed`, `shipping-key-unknown`) — never compared with an order-level address;
  - no delivery address at all: the country only, from `order.country` (country-only fallback).

Before this:
- a repeated id is filed once (a warning gives how many were dropped);
- an order carrying **more than 100** distinct references is neither checked nor filed: an **error** log carries the count and the message is acknowledged;
- a reference that is not a well-formed Stripe id (a string of 1–255 letters, digits or underscores) is refused without a provider call (`reference-malformed`).

A reference that fails binding — malformed, calculation not found (404 / `resource_missing`), any other permanent 4xx from the retrieve, a foreign `cartId`, a shipping-key mismatch, or an address mismatch — is **logged at error level and skipped, never filed**; when the retrieve failed, the log carries the provider's status, code and message. If **no** reference binds, nothing is filed and the message is still acknowledged. Two retrieve failures are **not** verdicts about the reference, and are re-thrown before anything is filed so that Pub/Sub redelivers the message (Rule 5):
- a **transient** failure (no status, 409, 429, 5xx), answered with the provider's status (500 when it has none);
- a **401 or 403** — a rejected API key, or one missing a permission — logged at error level as a credentials or permissions failure and answered **500** with a fixed message. The message keeps redelivering until the key is fixed.

`order-syncer` never recalculates (Rule 1), so a failed reference is skipped, never recomputed.

`jurisdictionKey` and `orderDestinationForCalculation` are **copies** of `tax-calculator`'s `createAddressKey` and `extractCustomerAddress` — the two modules share no code. They are held in step by a parity fixture vendored in each module (`<module>/test-fixtures/jurisdiction-parity.json`, the two copies pinned identical by a shared SHA-256 both suites assert — commercetools Connect bundles each application in isolation, so a single repo-root fixture would not ship with either bundle), which each module's own suite runs against its own functions (`order-syncer/test/unit/validators/jurisdiction-parity.spec.js`, `tax-calculator/test/unit/services/jurisdiction-parity.spec.js`), with the names of the line-item stamps in its `stamps` section (`calculation-reference-contract.md` Rule 6). Change both and the fixtures together.

**Why:** Binding at filing time checks every reference the order carries; no calculation whose destination differs from where the order ships is filed.

**Invariant:** Every reference filed by `order-syncer` names a Stripe calculation whose line items carry the order's `cart.id` and whose `customer_details.address` matches the destination `tax-calculator` sent for it. A reference that does not is skipped and logged, never filed, and never recalculated. A transient failure to check a reference, or a rejected API key, is redelivered, never treated as a mismatch. No reference id is filed twice, and no list of more than 100 distinct references is checked or filed.

**Implementation:** `order-syncer/src/validators/calculation-binding.validators.js` (`partitionReferencesByOrderBinding`, the format check and the error classes), called from `order-syncer/src/controllers/sync.controller.js` (`syncOrderToTaxProvider`: de-duplication and the bound, `MAX_CALCULATION_REFERENCES`); retrieve in `order-syncer/src/extensions/stripe/clients/client.js` (`retrieveCalculation`).
