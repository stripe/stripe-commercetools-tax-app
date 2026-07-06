# Process Tax Calculation

**Trigger:** The commercetools API Extension fires on cart Create/Update for carts where `taxMode="ExternalAmount"`, POSTing the cart to `/taxCalculator/` with a 2000ms timeout (`src/connectors/action.js:31-34`).
**Modules involved:** tax-calculator only (standalone service; no sibling-module involvement).
**Outcome:** A set of commercetools cart update actions applying Stripe-calculated tax rates per line item and per shipping method.

## Happy Path

1. CT API Extension POSTs the cart (`body.resource.obj`) to the tax endpoint — `src/routes/tax.calculator.route.js:7`.
2. Controller receives the request and invokes the orchestrator — `src/controllers/tax.calculator.controller.js:12`.
3. Category resolution: product categories are fetched from CT (batched, expanded, cached) — `src/services/category.service.js:145`.
4. Ship-from resolution: per-shipment origin resolved via channel → inventory → default chain — `src/services/ship-from.service.js:96,125`.
5. Tax-code resolution: each product's Stripe tax code read from its category `connectorStripeTax_TaxCode` custom field — `src/services/tax-code.service.js:36-69`.
6. Tax-behavior resolution: `tax_behavior` for line items from `TAX_BEHAVIOR_DEFAULT` / `TAX_BEHAVIOR_COUNTRY_MAPPING`; shipping forced to `'exclusive'` — `src/services/tax-orchestrator.service.js:277,397`.
7. Stripe calls: `tax.calculations.create` invoked in parallel, one per ship-from / shipping-method group, via `Promise.allSettled` — `src/services/tax-orchestrator.service.js:546`.
8. Update actions: successful Stripe results translated into CT cart update actions (tax rates per line item and shipping method) — `src/services/update-action.service.js`.
9. Controller returns the update actions to CT, which applies them to the cart.

## Error Paths

| Condition | Behavior | File |
| --- | --- | --- |
| Product category lacks `connectorStripeTax_TaxCode` custom field | Throws `TaxCodeNotFoundError` (no fallback strategy runs) | `src/services/tax-code.service.js:36-69` |
| `shippingInfo` present but `shippingMethod` absent | Unhandled `TypeError` (no null guard) | `src/services/tax-code.service.js:264` |
| Some Stripe calculations fail (partial) | Failed ones dropped (warn), update actions returned for successes only — tax under-reported | `src/services/tax-orchestrator.service.js:535-587` |
| All Stripe calculations fail | Throws | `src/services/tax-orchestrator.service.js:546` |
| CT channel/inventory lookup fails | Logged warn, returns null → default ship-from used silently | `src/services/ship-from.service.js:111-114,161-164` |
| Category batch fetch fails | Batch logged and skipped → products get empty categories | `src/services/category.service.js:201-213` |

## Notes

- **Partial-failure under-reporting (HIGH):** because step 7 uses `Promise.allSettled` and step 8 only builds actions from fulfilled results, a cart with one failing ship-from/shipping-method group is silently taxed as if that group did not exist. The request succeeds and returns update actions covering only the successful groups. See `context/known-issues.md` Issue 2. This is a tax-compliance risk — do not treat a 200 response as proof all groups were calculated.
- **No idempotency key** is passed to `tax.calculations.create`; repeated extension firings create duplicate (ephemeral) Stripe calculations (`context/known-issues.md` Issue 15).
- **Hardcoded fallbacks:** country `'US'` and currency `'USD'` are used as fallbacks in `update-action.service.js`; shipping `tax_behavior` is always `'exclusive'` (Issues 11, 12).
