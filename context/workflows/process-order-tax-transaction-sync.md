# Process Order Tax Transaction Sync

**Trigger:** the commercetools subscription `ct-connect-tax-integration-order-change-subscription` publishes an
`OrderCreated` message to Google Cloud Pub/Sub, which pushes it as `POST /orderSyncer`
(`order-syncer/src/constants/connectors.constants.js:1-4`; `order-syncer/src/connectors/action.js:22-40`;
`order-syncer/src/index.js:21`).
**Modules involved:** order-syncer. It reads the `connectorStripeTax_calculationReferences` that tax-calculator
wrote on the cart and the platform copied to the order (`business-rules/calculation-reference-contract.md`
Rule 3, *The cart-to-order copy of the references is platform behaviour, not code*).
**Outcome:** one Stripe Tax transaction per stored calculation reference **that belongs to the order**
(`business-rules/order-sync.md` Rule 11, *A reference is filed only when the calculation it names belongs to
this order*). Their ids are written to the order's `connectorStripeTax_transactionReferences` and to the first
payment intent's `tax_transactions` metadata. The handler answers HTTP 204.

## Happy Path

1. Read `request.body.message.data` — `order-syncer/src/controllers/sync.controller.js:42`
2. Base64-decode and parse the JSON — `order-syncer/src/utils/decoder.util.js:9-13`
3. Validate the message: not a subscription confirmation, type `OrderCreated`, resource an order with an id —
   `order-syncer/src/controllers/sync.controller.js:52`; `order-syncer/src/validators/order-change.validators.js:11-44`
4. Fetch the order with its payments expanded — `order-syncer/src/clients/query.client.js:10-22`
5. Read the calculation references and the first payment's `interfaceId`; drop repeated ids —
   `order-syncer/src/controllers/sync.controller.js:85-86`, `:108-115`
6. Bind each reference to the order: refuse it, without retrieving it, if it is not a well-formed Stripe id;
   otherwise retrieve its calculation (`expand: ['line_items']`) and keep it only when every line item carries
   `order.cart.id` and its address matches the destination tax-calculator sent for it; the others are logged
   and not filed — `order-syncer/src/controllers/sync.controller.js:116-119`;
   `order-syncer/src/validators/calculation-binding.validators.js:133-192`
7. Commit the transactions for the references that bound:
   - one reference → `getTransactionFromTaxCalculation` — `order-syncer/src/controllers/sync.controller.js:128-136`
   - two or more → `createTaxTransactions`, one after another — `order-syncer/src/controllers/sync.controller.js:137-143`
8. Each transaction is `tax.transactions.createFromCalculation({ calculation, reference: calculation, metadata: { ct_order_id, paymentIntentId } })` —
   `order-syncer/src/extensions/stripe/clients/client.js:41-48`, `:88-97`
9. Re-fetch the order for its version, then `setCustomField` the transaction ids, replacing any previous value —
   `order-syncer/src/clients/update.client.js:13-35`
10. When a payment intent id exists, overwrite its `tax_transactions` metadata —
   `order-syncer/src/controllers/sync.controller.js:146-148`; `order-syncer/src/extensions/stripe/clients/client.js:110-120`
11. 204 — `order-syncer/src/controllers/sync.controller.js:75`

## Error Paths

| Condition | Behavior | File |
| --- | --- | --- |
| No `message.data` | 202 | `order-syncer/src/controllers/sync.controller.js:42-48` |
| `data` is not base64 JSON | 500 | `order-syncer/src/utils/decoder.util.js:13-15` |
| Subscription-confirmation message (`ResourceCreated`) | 204 | `order-syncer/src/validators/order-change.validators.js:20-25` |
| Wrong message type, wrong resource type, or no id | 202 | `order-syncer/src/validators/order-change.validators.js:27-43` |
| The same reference id appears more than once | filed once; warning with the number dropped | `order-syncer/src/controllers/sync.controller.js:108-111` |
| A reference is not a well-formed Stripe id (`^[A-Za-z0-9_]{1,255}$`, a string) | that reference is not retrieved or filed; the others proceed | `order-syncer/src/validators/calculation-binding.validators.js:139-148`; `order-syncer/src/controllers/sync.controller.js:117-119` |
| A reference does not belong to the order (calculation not found, other permanent 4xx, foreign `cartId`, no or unknown `shippingKey` in Multiple mode, address mismatch) | that reference is not filed, error log; the others proceed | `order-syncer/src/validators/calculation-binding.validators.js:158-188`; `order-syncer/src/controllers/sync.controller.js:117-119` |
| No reference belongs to the order | 204, nothing written | `order-syncer/src/controllers/sync.controller.js:120-125` |
| Stripe refuses the API key while binding (401, or 403 for a missing permission) | 500 with a fixed message → redelivered until the key is fixed; error log; nothing was filed | `order-syncer/src/validators/calculation-binding.validators.js:153-157`; `order-syncer/src/controllers/sync.controller.js:64-71` |
| Transient Stripe failure while binding (no status, 409, 429, 5xx) | the Stripe error's status (or 500) → redelivered; nothing was filed | `order-syncer/src/validators/calculation-binding.validators.js:158-162`; `order-syncer/src/controllers/sync.controller.js:64-71` |

## Notes

- **The meaning of 2xx.** On a push subscription a 2xx acknowledges the message, so **every 2xx above is
  final**; only 500 or a Stripe error status leads to redelivery (`business-rules/order-sync.md` Rule 5).
- **A transaction's `reference` is the calculation id** (`business-rules/order-sync.md` Rule 10).
- **This module creates the order's transaction field, not the reference field it reads.** Its post-deploy
  adds only `connectorStripeTax_transactionReferences`; the references field exists because tax-calculator's
  post-deploy created it (`order-syncer/src/connectors/customTypes.js:22-38`;
  `business-rules/calculation-reference-contract.md` Rule 2, *The reference field's definition exists only because `tax-calculator`'s post-deploy created it*). See `process-deploy-and-undeploy.md`.
