# Stripe Tax API — Reference

> What this connector uses from this API. Not a complete reference.

## Version in use

`stripe` npm package, v16 (per `CLAUDE.md` Stack) — `stripe@^16.12.0`, in both
`tax-calculator/package.json` and `order-syncer/package.json`.

No `apiVersion` is pinned when a client is constructed, so the SDK's default applies. There are
four separate client instances: `tax-calculator/src/clients/stripe.client.js:15` (cart path),
`tax-calculator/src/services/address.service.js:5` (address check, built at module load from
`STRIPE_API_TOKEN`), `tax-calculator/src/validators/stripeTaxValidator.js:6` (post-deploy) and
`order-syncer/src/extensions/stripe/clients/client.js:13`.

## What this unit uses it for

Quoting tax on carts (calculations), committing it on orders (transactions), checking that an
address is taxable, verifying the account at deploy, and tagging payment intents.

| Concept / Class | How this connector uses it |
| --- | --- |
| `stripe.tax.calculations` | Created per shipping-key/ship-from group in `tax-calculator` (parallel via `Promise.allSettled`); retrieved by ID for the re-apply exception (`business-rules/tax-calculation.md` Rule 2) |
| `stripe.tax.transactions` | Created from a calculation ID in `order-syncer`, once the order is created — this commits the calculation as a reportable Stripe Tax transaction |
| `stripe.tax.settings` | Retrieved at post-deploy only, to validate the Stripe Tax configuration before registering the CT extension |
| `stripe.paymentIntents` | Updated in `order-syncer` to add metadata `tax_transactions` to the order's first payment's PaymentIntent |

## Calls used

| Method | What it does | Where called in this connector |
| --- | --- | --- |
| `tax.calculations.create` | Computes tax for a set of line items + shipping, per ship-from group (and per shipping method in Multiple mode) | `tax-calculator/src/services/tax-orchestrator.service.js:652` |
| `tax.calculations.create` (address verification) | Creates a real, persisted calculation with dummy values (`amount=100`, `tax_code=txcd_99999999`) solely to validate an address | `tax-calculator/src/services/address.service.js:148` |
| `tax.calculations.retrieve(id, { expand: ['line_items'] })` | Re-fetches an existing calculation for the re-apply exception | `tax-calculator/src/services/tax-orchestrator.service.js:739` |
| `tax.calculations.retrieve(id, { expand: ['line_items'] })` (order-syncer) | Re-fetches each stored calculation before filing it, to bind it to the order (cart id on every line item, destination) — `business-rules/order-sync.md` Rule 11 | `order-syncer/src/extensions/stripe/clients/client.js:25` |
| `tax.transactions.createFromCalculation` | Commits a calculation as a Stripe Tax transaction after order creation, with `reference` = the calculation ID and metadata `ct_order_id`, `paymentIntentId` | `order-syncer/src/extensions/stripe/clients/client.js:41` (single reference), `:97` (several references) |
| `tax.transactions.retrieve` | Reads the transaction an "already exists" error names, and adopts it only when its `metadata.ct_order_id` is this order | `order-syncer/src/extensions/stripe/clients/client.js:56` |
| `tax.settings.retrieve` | Validates Stripe Tax is configured correctly before deploy | `tax-calculator/src/validators/stripeTaxValidator.js:19` |
| `paymentIntents.update` (metadata) | Links the payment to the transactions | `order-syncer/src/extensions/stripe/clients/client.js:112` |

## Constraints that affect this unit

- **`createFromCalculation` requires a unique `reference`** — `reference` must be unique across
  all transactions, including reversals (Stripe Tax API). The connector passes the calculation ID
  as `reference`, and transaction de-duplication relies on it. The re-apply exception retrieves
  and re-emits the existing calculation instead of creating a new one for a cart that already has
  a PaymentIntent (`business-rules/tax-calculation.md` Rule 2).
- **Error recognition.** Provider errors are recognised when `error.type` is
  `StripeInvalidRequestError` or `StripeAPIError`
  (`tax-calculator/src/services/tax-error-handler.service.js:122-124`).
- **Calculations expire.** A transaction can be created from a calculation only while it has not
  expired; calculations expire after 90 days (Stripe Tax API). The connector stores `expires_at`
  on the cart (`tax-calculator/src/services/update-action.service.js:212`).
- **Inclusive amounts.** For a calculation line item, if `tax_behavior=inclusive` the amount
  includes taxes; otherwise taxes were calculated on top of the amount (Stripe Tax API,
  `line_items.data.amount`).
- **Error codes the connector maps** (`customer_tax_location_invalid`, `shipping_address_invalid`,
  `invalid_tax_location`, `taxes_calculation_failed`, `stripe_tax_inactive`) all exist in Stripe's
  error-code list. Mapping: `tax-calculator/src/services/tax-error-handler.service.js:144-183`,
  `tax-calculator/src/services/address.service.js:319-371`.

## What this unit deliberately does NOT use

- Reversals (`tax.transactions.createReversal`) — there is no refund or cancel path.
- Tax registrations APIs.
- Customer tax IDs / `customer_details.tax_ids`.
- Webhooks.
- `apiVersion` pinning and idempotency keys.
