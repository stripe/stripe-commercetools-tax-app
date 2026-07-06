# order-syncer — Architecture

## Overview

`order-syncer` is an Express (v4) event-handler that receives commercetools "OrderCreated" events via Google Pub/Sub push. On each event it reads the order's Stripe tax calculation references from a custom field, commits them as Stripe tax transactions (`tax.transactions.createFromCalculation`), and writes the resulting transaction IDs back to the commercetools order custom field and to the Stripe PaymentIntent metadata. It is a JavaScript ESM module (`"type": "module"`).

## Entry Points

| Trigger | Detail | File | Auth |
| --- | --- | --- | --- |
| HTTP POST | `/orderSyncer` (router mounted at `/orderSyncer`, route path `/`) — Pub/Sub push message with `body.message.data` base64 payload | src/index.js:21, src/routes/sync.route.js:7 | none — no auth middleware on the route; relies on platform Pub/Sub delivery |
| CLI | `node src/connectors/post-deploy.js` — creates CT subscription + custom types | src/connectors/post-deploy.js:43 | — |
| CLI | `node src/connectors/pre-undeploy.js` — deletes CT subscription + custom types | src/connectors/pre-undeploy.js:34 | — |

## Directory Map

```
order-syncer/
  src/
    index.js                         Express app bootstrap; listens on port 8080,
                                     body-parser JSON limit '1mb', mounts router at
                                     '/orderSyncer' (index.js:10,16,21)
    routes/
      sync.route.js                  Router: POST '/' → controller (sync.route.js:7)
    controllers/
      sync.controller.js             Orchestrates read → commit → write-back;
                                     uses payments[0] for PaymentIntent (sync.controller.js:50,78)
    clients/
      query.client.js                CT getOrder (with paymentInfo expand) (query.client.js:10-41)
      update.client.js               CT update order custom field (update.client.js:21-35)
    connectors/
      post-deploy.js                 CLI: create CT subscription + custom types (post-deploy.js:43)
      pre-undeploy.js                CLI: delete CT subscription + custom types (pre-undeploy.js:34)
      action.js                      CT subscription + custom-type actions (action.js)
      customTypes.js                 Custom type + field definitions (customTypes.js:10-15)
    extensions/
      stripe/
        configurations/config.js     loadConfig() reads STRIPE_API_TOKEN (config.js:2)
        clients/client.js            Stripe tax.transactions.createFromCalculation,
                                     paymentIntents.update, regex ID recovery (client.js:29-93)
    validators/
      env-var.validator.js           CTP credential length rules (env-var.validator.js:19,29)
      helpers.validator.js           Allowed CT region list (helpers.validator.js:129-135)
      order-change.validators.js     doValidation; skip signals via CustomError 204/202
    middlewares/
      auth.middleware.js             Scaffolded auth option builder (auth.middleware.js:5,16)
      http.middleware.js             Scaffolded HTTP option builder (http.middleware.js:5)
      error.middleware.js            errorMiddleware — exported but never registered (error.middleware.js:11)
    constants/
      connectors.constants.js        Message type filter, subscription key (connectors.constants.js:1-3)
      http.status.constants.js       202 / 204 / 500 (http.status.constants.js:1-3)
    utils/
      config.util.js                 readConfiguration() validates env vars (config.util.js:13-18)
      async-logger.utils.js          Fire-and-forget logger; empty inner catch (async-logger.utils.js:34-36)
```

## External Dependencies

| Service | Operation | File | Error Handling |
| --- | --- | --- | --- |
| CT Platform API | getOrder with paymentInfo expanded | src/clients/query.client.js:10-22 | `.catch` re-throws as CustomError statusCode 202; controller returns HTTP 202 to Pub/Sub |
| CT Platform API | getOrder | src/clients/query.client.js:29-41 | `.catch` re-throws as CustomError statusCode 202 |
| CT Platform API | update order custom field | src/clients/update.client.js:21-35 | `.catch` re-throws as CustomError statusCode 202 |
| CT Platform API | list subscriptions | src/connectors/action.js:58-65 | no try/catch — propagates to CLI run() which writes stderr + exit 1 |
| CT Platform API | create subscription | src/connectors/action.js:22-40 | no try/catch — propagates to CLI run() |
| CT Platform API | delete subscription | src/connectors/action.js:70-78 | no try/catch — propagates to CLI run() |
| CT Platform API | list types | src/connectors/action.js:159-166 | try/catch — returns [] on 404, otherwise re-throws |
| CT Platform API | add/remove field def or create/delete type | src/connectors/action.js:127-148,228-248 | createCustomTypes re-throws; deleteCustomTypes catches per-type and logs only (swallowed) |
| Stripe API | tax.transactions.createFromCalculation (single-calc path) | src/extensions/stripe/clients/client.js:29-36 | try/catch — error swallowed; recovers existing transaction ID by regex-parsing error.message; warns only if code ≠ resource_missing and status ≠ 404 |
| Stripe API | tax.transactions.createFromCalculation (multi-calc loop) | src/extensions/stripe/clients/client.js:70-71 | no try/catch, single attempt per reference — error propagates to controller (HTTP 500) |
| Stripe API | paymentIntents.update (metadata) | src/extensions/stripe/clients/client.js:85-89 | try/catch — error swallowed, warn-logged only, not re-thrown |

## Key Configuration

| Key | Source | Required | Default | File |
| --- | --- | --- | --- | --- |
| CTP_CLIENT_ID | env var | yes | — | src/utils/config.util.js:13 |
| CTP_CLIENT_SECRET | env var | yes | — | src/utils/config.util.js:14 |
| CTP_PROJECT_KEY | env var | yes | — | src/utils/config.util.js:15 |
| CTP_SCOPE | env var | no (optional validator) | — (falls back to 'default' scope) | src/utils/config.util.js:16, src/middlewares/auth.middleware.js:16 |
| CTP_REGION | env var | yes | — | src/utils/config.util.js:17 |
| STRIPE_API_TOKEN | env var | yes | — | src/utils/config.util.js:18, src/extensions/stripe/configurations/config.js:2 |
| CONNECT_GCP_TOPIC_NAME | env var | no (read but not validated; passed as undefined if absent) | — | src/connectors/post-deploy.js:16 |
| CONNECT_GCP_PROJECT_ID | env var | no (read but not validated) | — | src/connectors/post-deploy.js:17 |
| CUSTOM_TYPE_ORDER_KEY | env var | no | 'connector-stripe-tax-calculation-reference' | src/connectors/customTypes.js:15 |
