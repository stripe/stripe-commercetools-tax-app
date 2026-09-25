# ADR-004 — Pub/Sub for Reliable Order Sync Decoupling

**Status:** Accepted  
**Date:** 2024

## Context

When a CT order is created, the Stripe Tax Calculation used during checkout must be converted to a Stripe Tax Transaction (`tax_xxx`). This confirms the tax event for reporting and compliance.

This conversion is not time-critical from the customer's perspective (the order is already placed), but it must be reliable — missed conversions would cause reporting gaps in Stripe Tax.

## Decision

Use **Google Cloud Pub/Sub** (asynchronous) for order sync instead of a synchronous hook.

The flow:

1. CT publishes an `OrderCreated` message to Pub/Sub (subscription created on deploy by `order-syncer/src/connectors/post-deploy.js` → `createChangedOrderSubscription`).
2. The `order-syncer` module receives the message via `POST /orderSyncer` and decodes the base64 body via `utils/decoder.util.js` → `decodeToJson()`.
3. Reads `connectorStripeTax_calculationReferences` (a `Set of String`) from the order's custom fields via `clients/query.client.js` → `getOrderWithPaymentInfo()`.
4. Calls `stripe.tax.transactions.createFromCalculation()` once per reference (single-ref path uses `getTransactionFromTaxCalculation`; multi-ref path uses `createTaxTransactions`).
5. Stores all resulting transaction IDs on the CT order's `connectorStripeTax_transactionReferences` (Set of String) via `clients/update.client.js` → `updateOrderTaxTxn`.
6. If a PaymentIntent is attached to the order, mirrors the transaction IDs into `paymentIntent.metadata.tax_transactions` (best-effort; failures are logged as warnings).

## Consequences

- Order creation in CT is not blocked by Stripe Tax transaction creation — better checkout reliability
- Pub/Sub provides at-least-once delivery with configurable retry — missed transactions due to transient Stripe failures are automatically retried
- The order-syncer must be idempotent: calling `createFromCalculation()` with the same Calculation ID twice must not create duplicate transactions (Stripe handles this with idempotency keys)
- Requires Google Cloud Pub/Sub infrastructure — topic and subscription are created on deploy by `post-deploy.js`
- If `connectorStripeTax_calculationReferences` is missing or empty on the order (edge case: order created outside normal checkout flow), the order-syncer logs a warning (`Order ${id} has no calculation references. Skipping.`) and acknowledges the message with HTTP 204 — it does not fail the message
- HTTP status conventions: success (incl. skip path) → 204; "missing message data" guard and CT update failures → 202 (ack, no retry); JSON decode failures and any other unhandled error → 500 (nack, retried by Pub/Sub)

## Alternatives Considered

| Option | Reason rejected |
|---|---|
| CT API Extension on OrderCreated | Synchronous; blocks order creation if Stripe Tax is slow |
| Polling CT for new orders | Inefficient; adds latency; not event-driven |
| Stripe webhook (reverse direction) | Stripe does not emit events for CT order creation |
