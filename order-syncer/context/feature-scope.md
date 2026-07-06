# order-syncer — Feature Scope

## What is Supported

- Receives commercetools "OrderCreated" events as Google Pub/Sub push messages at `POST /orderSyncer` (router mounted at `/orderSyncer`, route path `/`); the payload arrives base64-encoded in `body.message.data` (src/index.js:21, src/routes/sync.route.js:7).
- Filters incoming messages to accept only `OrderCreated` message types and skips `ResourceCreated` notifications (src/constants/connectors.constants.js:1-2).
- Reads the order (with `paymentInfo.payments[*]` expanded) from the CT Platform API and extracts the Stripe tax calculation references from the order custom field `connectorStripeTax_calculationReferences` (src/clients/query.client.js:10-41, src/controllers/sync.controller.js:49,77).
- Commits Stripe tax transactions from calculation references via `tax.transactions.createFromCalculation`, supporting both a single-calculation path and a multi-calculation loop (src/extensions/stripe/clients/client.js:29-36,70-71).
- Recovers an already-committed transaction ID by regex-parsing the Stripe duplicate-commit error message (`/tax transaction (tax_\w+)/`), providing best-effort idempotency on retries (src/extensions/stripe/clients/client.js:38).
- Writes the resulting transaction IDs back to the CT order custom field `connectorStripeTax_transactionReferences` (src/clients/update.client.js:21-35, src/connectors/customTypes.js:11).
- Writes the transaction IDs to the Stripe PaymentIntent metadata under key `tax_transactions`, tagging transactions with metadata keys `ct_order_id` and `paymentIntentId` (src/extensions/stripe/clients/client.js:33-34,64-65,87).
- Provisions and tears down its CT wiring via CLI: `post-deploy.js` creates the CT subscription (`ct-connect-tax-integration-order-change-subscription`, GoogleCloudPubSub destination) and custom types; `pre-undeploy.js` deletes them (src/connectors/post-deploy.js:43, src/connectors/pre-undeploy.js:34, src/connectors/action.js:28, src/constants/connectors.constants.js:3).

## What is Out of Scope

- Does **not** calculate tax. This module only commits pre-existing Stripe tax calculation references; the `connectorStripeTax_calculationReferences` field it reads is not created by this module (assumed created by the sibling `tax-calculator` module) (src/controllers/sync.controller.js:49,77, src/connectors/customTypes.js:23-38).
- Handles **only** `OrderCreated`. It does not process order updates, order state changes, cancellations, or refunds — all other message types are filtered out (src/constants/connectors.constants.js:1-2).
- Does **not** authenticate the inbound HTTP request. There is no auth middleware on the `/orderSyncer` route; delivery trust relies entirely on the platform Pub/Sub channel (src/routes/sync.route.js:7).
- Does **not** handle orders with multiple payments correctly — only the first payment (`payments[0]`) is inspected for the PaymentIntent ID (src/controllers/sync.controller.js:50,78).
- Does **not** export anything to, or import from, the sibling `tax-calculator` module. No cross-module calls occur.
- Does **not** reconcile CT and Stripe state after the fact. A single push message is processed and acknowledged; there is no background retry, sweep, or reconciliation job.

## Configuration-Driven Behavior

- `CUSTOM_TYPE_ORDER_KEY` overrides the CT custom type key used for the order tax references; defaults to `'connector-stripe-tax-calculation-reference'` when unset (src/connectors/customTypes.js:15).
- `CTP_SCOPE` is optional; when absent the CT client falls back to the `'default'` scope (src/utils/config.util.js:16, src/middlewares/auth.middleware.js:16).
- `CONNECT_GCP_TOPIC_NAME` and `CONNECT_GCP_PROJECT_ID` are read at post-deploy time to configure the CT subscription's Pub/Sub destination; neither is validated (src/connectors/post-deploy.js:16-17).
- `CTP_REGION` must be one of a hardcoded allow-list of five regions; any other value is rejected by the validator (src/validators/helpers.validator.js:129-135).
