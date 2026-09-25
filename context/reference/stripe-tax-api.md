# Stripe Tax API — Reference

> What the `ct-stripe-tax` connector uses from this API. Not a complete reference.

## SDK version

`stripe` npm package, v16 (per `CLAUDE.md` Stack) — `stripe@^16.12.0`.

## What this connector uses

| Concept / Class | How this connector uses it |
| --- | --- |
| `stripe.tax.calculations` | Created per shipping-key/ship-from group in `tax-calculator` (parallel via `Promise.allSettled`); retrieved by ID for the re-apply exception (`business-rules/tax-calculation.md` Rule 2) |
| `stripe.tax.transactions` | Created from a calculation ID in `order-syncer`, once the order is created — this commits the calculation as a reportable Stripe Tax transaction |
| `stripe.tax.settings` | Retrieved at post-deploy only, to validate the Stripe Tax configuration before registering the CT extension |

## Key API calls used

| Method | What it does | Where called in this connector |
| --- | --- | --- |
| `tax.calculations.create` | Computes tax for a set of line items + shipping, per ship-from group | `tax-calculator/src/services/tax-orchestrator.service.js:546` |
| `tax.calculations.create` (address verification) | Creates a real, persisted calculation with dummy values (`amount=100`, `tax_code=txcd_99999999`) solely to validate an address | `tax-calculator/src/services/address.service.js:148` |
| `tax.calculations.retrieve` | Re-fetches an existing calculation for the re-apply exception | `tax-calculator/src/services/tax-orchestrator.service.js:616` |
| `tax.transactions.createFromCalculation` | Commits a calculation as a Stripe Tax transaction after order creation | `order-syncer/src/extensions/stripe/clients/client.js:25-46,55-75` |
| `tax.settings.retrieve` | Validates Stripe Tax is configured correctly before deploy | `tax-calculator/src/validators/stripeTaxValidator.js:19` |

## Constraints relevant to this connector

- **Calculations have a monthly quota** and Stripe does not distinguish "real" cart calculations from calculations created purely for address verification — see `../known-issues.md` Issue 3 (phantom quota consumption) and `../failure-modes.md`.
- **No dry-run/validation-only calculation endpoint exists** — verifying an address without creating a real, quota-counted calculation is not possible with the current Stripe Tax API.
- **No "find transaction by calculation ID" lookup endpoint exists** — `order-syncer` works around this by parsing the "already exists" error message with a regex, which is fragile to Stripe error-message format changes (see `../known-issues.md` Issue 19).
- **`createFromCalculation` rejects duplicate transactions for the same calculation ID** — this is what the regex-based recovery in the point above is working around, and it's also why the re-apply exception (business rule 2) retrieves and re-emits the *existing* calculation instead of creating a new one for a cart that already has a PaymentIntent.
