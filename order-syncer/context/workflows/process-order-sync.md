# Process Order Sync

**Trigger:** A commercetools `OrderCreated` event delivered as a Google Pub/Sub push message to `POST /orderSyncer`.
**Modules involved:** order-syncer (this module only — no cross-module calls).
**Outcome:** Stripe tax transactions are committed from the order's calculation references, and the resulting transaction IDs are written back to the CT order custom field `connectorStripeTax_transactionReferences` and to the Stripe PaymentIntent metadata key `tax_transactions`.

## Happy Path

1. Express receives the Pub/Sub push and body-parses the JSON (limit `1mb`); the router mounted at `/orderSyncer` routes `POST /` to the controller — `src/index.js:16,21`, `src/routes/sync.route.js:7`.
2. The controller decodes the base64 payload from `body.message.data` and runs validation, filtering to `OrderCreated` and skipping `ResourceCreated` — `src/controllers/sync.controller.js`, `src/validators/order-change.validators.js`, `src/constants/connectors.constants.js:1-2`.
3. The controller fetches the order from CT with `paymentInfo.payments[*]` expanded — `src/clients/query.client.js:10-22`.
4. The controller reads the calculation references from the order custom field `connectorStripeTax_calculationReferences`; if absent, the order is skipped — `src/controllers/sync.controller.js:49,77`.
5. Stripe tax transactions are committed via `tax.transactions.createFromCalculation`, tagging each with metadata `ct_order_id` and `paymentIntentId`:
   - single-calculation path — `src/extensions/stripe/clients/client.js:29-36`;
   - multi-calculation loop (one call per reference) — `src/extensions/stripe/clients/client.js:70-71`.
6. On a duplicate/already-committed calculation, the single-calc path recovers the existing transaction ID by regex-parsing the Stripe error message (`/tax transaction (tax_\w+)/`) — `src/extensions/stripe/clients/client.js:38`.
7. The resulting transaction IDs are written back to the CT order custom field `connectorStripeTax_transactionReferences` — `src/clients/update.client.js:21-35`.
8. The transaction IDs are written to the Stripe PaymentIntent metadata under `tax_transactions`, using the PaymentIntent from `payments[0]` — `src/extensions/stripe/clients/client.js:85-89`, `src/controllers/sync.controller.js:50,78`.
9. The controller returns a success HTTP status to Pub/Sub — `src/constants/http.status.constants.js:1-3`.

## Error Paths

| Condition | Behavior | File |
| --- | --- | --- |
| Message is not `OrderCreated` / is `ResourceCreated` | Skipped via CustomError skip-signal → returned as HTTP status (204/202) | src/validators/order-change.validators.js, src/constants/connectors.constants.js:1-2, src/controllers/sync.controller.js:58-60 |
| Order lacks `connectorStripeTax_calculationReferences` | Skipped silently | src/controllers/sync.controller.js:49,77 |
| CT getOrder fails (expanded or plain) | Re-thrown as CustomError statusCode 202 → HTTP 202 to Pub/Sub (message acknowledged, not retried) | src/clients/query.client.js:20, :29-41, src/controllers/sync.controller.js:58 |
| CT update order custom field fails | Re-thrown as CustomError statusCode 202 → HTTP 202 (message acknowledged, not retried) | src/clients/update.client.js:34, src/controllers/sync.controller.js:58 |
| Stripe single-calc commit rejects (duplicate) | Error swallowed; existing transaction ID recovered by regex; warns only if code ≠ resource_missing and status ≠ 404 | src/extensions/stripe/clients/client.js:29-38 |
| Stripe multi-calc loop commit fails | No try/catch — error propagates to controller → HTTP 500 | src/extensions/stripe/clients/client.js:70-71, src/constants/http.status.constants.js |
| Stripe paymentIntents.update fails | Error swallowed, warn-logged only, not re-thrown → `tax_transactions` metadata may be missing | src/extensions/stripe/clients/client.js:85-93 |

## Notes

- No authentication is performed on `POST /orderSyncer`; the module trusts platform Pub/Sub delivery — `src/routes/sync.route.js:7`.
- The 202-on-CT-failure behavior means genuine CT failures are acknowledged as success and not retried (see known-issues Issue 2, ADR-001).
- The regex-based transaction-ID recovery is the module's idempotency mechanism on duplicate commits and is fragile to Stripe error-copy changes (see known-issues Issue 1, ADR-002).
- Only `payments[0]` is used for the PaymentIntent ID; multi-payment orders may use the wrong or no PaymentIntent (see known-issues Issue 5).
- `errorMiddleware` is not registered on the app, so error handling relies on the controller's per-request catch, not centralized middleware (see known-issues Issue 6).
