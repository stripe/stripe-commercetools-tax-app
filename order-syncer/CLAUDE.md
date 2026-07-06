# order-syncer

## Overview

`order-syncer` is an event-handler module inside the client-owned `stripe-commercetools-tax-app` (integration: `commercetools-stripe-integration`). It is a JavaScript ESM Express (v4) service triggered by a Google Cloud Pub/Sub push whenever commercetools emits an `OrderCreated` event. On each event it reads the order's Stripe tax calculation references from the CT order custom field `connectorStripeTax_calculationReferences`, commits them as Stripe tax transactions via `tax.transactions.createFromCalculation`, and writes the resulting transaction IDs back to the CT order custom field `connectorStripeTax_transactionReferences` and to the Stripe PaymentIntent metadata (`tax_transactions`). It does not calculate tax and it handles only `OrderCreated` events.

## Structure

```
order-syncer/
  CLAUDE.md                          ← this file
  context/                           ← module knowledge base
  package.json                       (name misspelled "order-syncher" — see known-issues Issue 14)
  src/
    index.js                         Express bootstrap; port 8080; mounts '/orderSyncer'
    routes/sync.route.js             POST '/' → controller (no auth middleware)
    controllers/sync.controller.js   read → commit → write-back orchestration
    clients/
      query.client.js                CT getOrder (paymentInfo expanded)
      update.client.js               CT update order custom field
    connectors/
      post-deploy.js                 CLI: create CT subscription + custom types
      pre-undeploy.js                CLI: delete CT subscription + custom types
      action.js                      CT subscription + custom-type actions
      customTypes.js                 custom type + field definitions
    extensions/stripe/
      configurations/config.js       loadConfig() re-reads STRIPE_API_TOKEN
      clients/client.js              Stripe tax transaction commit + regex ID recovery
    validators/                      env-var, region allow-list, order-change validators
    middlewares/                     auth / http (scaffolded), error (unregistered)
    constants/                       message-type filter, subscription key, HTTP codes
    utils/                           config.util.js, async-logger.utils.js
```

## Before Every Task

Read in this order:

1. This file (`CLAUDE.md`) — module overview and rules
2. `context/ARCHITECTURE.md` — entry points, directory map, dependencies, configuration
3. `context/known-issues.md` — the 14 known gaps; check before changing any flagged area
4. `context/business-rules/` — the invariants this module enforces (`tax-transaction-sync.md`)
5. `context/workflows/` — the end-to-end sync flow (`process-order-sync.md`)

## Coding Rules

- **Monetary and tax amounts come from Stripe verbatim.** This module commits calculations and writes back IDs; it never recomputes tax. Do not add local tax computation.
- **commercetools is the source of truth for order state.** The only order mutation this module makes is writing the `connectorStripeTax_transactionReferences` custom field (src/clients/update.client.js:21-35). Do not add other order mutations or reconciliation logic.
- **Never assume a CT API failure during order sync is safe to acknowledge as success.** The current 202-on-failure behavior (known-issues Issue 2) is a known gap, not a pattern to replicate or extend. New downstream failures should be surfaced so Pub/Sub can retry.
- **Do not depend on parsing provider error text for business-critical values.** The regex transaction-ID recovery (known-issues Issue 1) is fragile; do not build new logic on top of it.
- **Verify the event subscription, don't assume it.** A handler existing is not proof it is subscribed — the subscription is created by `post-deploy.js` (`ct-connect-tax-integration-order-change-subscription`). Confirm the subscription configuration before assuming an event is delivered.
- **`connectorStripeTax_calculationReferences` is created upstream (assumed: `tax-calculator`), not here.** This module only defines `connectorStripeTax_transactionReferences` (src/connectors/customTypes.js). Do not assume the read field exists without verifying.
- **Only `payments[0]` is used for the PaymentIntent** (known-issues Issue 5). Do not add multi-payment logic without addressing that gap deliberately.
- **Validate deploy-time GCP config.** `CONNECT_GCP_TOPIC_NAME` / `CONNECT_GCP_PROJECT_ID` are currently unvalidated (known-issues Issue 8).
- **Keep credentials in env vars only.** Do not hardcode `STRIPE_API_TOKEN` or CTP credentials.

## What Claude Must Never Do

- **Never rely on the regex-based Stripe transaction-ID recovery** (`/tax transaction (tax_\w+)/`, src/extensions/stripe/clients/client.js:38) as a correctness guarantee, and never extend the pattern of extracting identifiers from provider error messages. It silently yields `undefined` if Stripe changes its error copy, marking an order synced with no transaction reference (known-issues Issue 1, HIGH).
- **Never acknowledge a genuine commercetools API failure to Pub/Sub as success (HTTP 202).** The existing mapping of CT failures to statusCode 202 (src/clients/query.client.js:20, src/clients/update.client.js:34, src/controllers/sync.controller.js:58) causes silent sync loss and must not be replicated for new failure paths (known-issues Issue 2, HIGH).
- **Never write a `centAmount` that is not an integer, and never compute financial amounts in a UI or client.** All provider calls stay in this backend handler.
