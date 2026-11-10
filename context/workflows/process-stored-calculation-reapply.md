# Process Stored Calculation Re-apply

**Trigger:** a `POST /taxCalculator` from the API extension for a cart where `isReapplyScenario(cart)` holds
(`tax-calculator/src/controllers/tax.calculator.controller.js:12-23`):
- `paymentInfo` is attached;
- the cart's tax was cleared — `taxedPrice` is absent, or, in Single mode with `shippingInfo`, the shipping
  `taxedPrice` is absent;
- at least one calculation reference is stored — tested by length, not by presence.

commercetools reaches the extension in this state only through the re-apply clause of the trigger condition
(`tax-calculator/src/connectors/action.js:31`; `business-rules/tax-calculation.md` Rule 2, *Extension trigger
filters on tax mode, line items, change set, and payment state*).
**Modules involved:** tax-calculator — `tax.calculator.controller.js`, `reapplyExistingCalculation()` in
`tax-orchestrator.service.js`, three builders of `update-action.service.js`, `tax-error-handler.service.js`.
**Outcome:** HTTP 200 `{ actions }` that restore the **first** stored calculation's tax without creating a new
calculation — but only for a **Single-mode** cart that still delivers to the exact jurisdiction (country +
state + city + postal code) the *retrieved* calculation was made for. A Multiple-mode cart, a calculation
Stripe reports as missing, a retrieved calculation that is not bound to this cart (no line items, or
a line item whose `metadata.cartId` is not this cart's), and a changed jurisdiction are each handled
instead as a fresh calculation (`process-tax-orchestration.md`), which writes new references.

## Happy Path

1. `isReapplyScenario(cart)` is true — `tax-calculator/src/controllers/tax.calculator.controller.js:43`
2. → `reapplyExistingCalculation(cart)` — `tax-calculator/src/controllers/tax.calculator.controller.js:66-67`
3. Read `connectorStripeTax_calculationReferences[0]` — `reapplyExistingCalculation()`, `tax-calculator/src/services/tax-orchestrator.service.js`
4. If `cart.shippingMode === 'Multiple'`, the function short-circuits to `orchestrateTaxCalculation()` (a fresh
   recalculation) — a Multiple-shipping cart is not re-applied
5. Otherwise **retrieve first:** `tax.calculations.retrieve(id, { expand: ['line_items'] }, { timeout: 1500, maxNetworkRetries: 0 })` — the stored
   calculation is fetched before any destination decision is made. The third options argument bounds the call
   — one attempt, no network retry, 1500 ms cap — against the extension's 2000 ms budget
6. **Bind the retrieved calculation to this cart first:** it must have line items, every one stamped with this
   cart's `metadata.cartId`; if it has **no** line items, or **any** line item's `metadata.cartId` is not this
   cart's id, the function short-circuits to `orchestrateTaxCalculation()` (a fresh recalculation) before the
   destination is compared — `reapplyExistingCalculation()`, `tax-calculator/src/services/tax-orchestrator.service.js`
7. The destination is read **from the retrieved calculation itself** (`calculation.customer_details.address`,
   the address Stripe taxed, which a shopper cannot write) and compared with the cart's current delivery address
   (`extractCustomerAddress(cart)`) at jurisdiction granularity via `createAddressKey()` — country + state +
   city + postal_code, null/undefined normalised. The cart field `connectorStripeTax_destinationCountry` is
   **not** read here. Equal keys → re-apply; different → recalculate
8. Line-item tax actions are built with **no** shipping key — `createLineItemActionsFromCalculation(calculation, null)`
9. A shipping tax action is built only when `cart.shippingInfo` is present (Single mode) — `createShippingTaxUpdateAction()`
10. The cart total action, when the total is positive — `createCartTotalTaxAction()`
11. 200 `{ actions }` — `return { actions }` in `reapplyExistingCalculation()`; `tax-calculator/src/controllers/tax.calculator.controller.js:70`

## Error Paths

| Condition | Behavior | File |
| --- | --- | --- |
| `cart.shippingMode === 'Multiple'` | **falls back to a full fresh calculation** — new Stripe calculations, new references; checked before `retrieve` | `reapplyExistingCalculation()`, `tax-calculator/src/services/tax-orchestrator.service.js` |
| `retrieve` fails with `resource_missing` / HTTP 404 (the stored calculation is gone) | **falls back to a full fresh calculation** — this is the only retrieve error that recalculates | `reapplyExistingCalculation()` catch block, `tax-calculator/src/services/tax-orchestrator.service.js` |
| The retrieved calculation has no line items, or a line item's `metadata.cartId` is not this cart's | **falls back to a full fresh calculation** — the retrieved calculation is not bound to this cart; checked after `retrieve`, before the jurisdiction compare | `reapplyExistingCalculation()`, `tax-calculator/src/services/tax-orchestrator.service.js` |
| The retrieved calculation's jurisdiction key differs from the cart's current delivery jurisdiction (country + state + city + postal code, via `createAddressKey()`) | **falls back to a full fresh calculation** — new references | `reapplyExistingCalculation()`, `tax-calculator/src/services/tax-orchestrator.service.js` |
| The current delivery address locates the order but has no country | 400 `InvalidInput` (`InvalidTaxDestinationError`), raised by `extractCustomerAddress(cart)` → `assertDestinationIsUsable()` while building the current jurisdiction key | `tax-calculator/src/services/tax-orchestrator.service.js`, `extractCustomerAddress()` / `assertDestinationIsUsable()` |
| No reference at `[0]` | plain `Error` → 500. Unreachable: the scenario requires a non-empty list | `reapplyExistingCalculation()`, `tax-calculator/src/services/tax-orchestrator.service.js` |
| `retrieve` fails with any non-missing error: the error is re-thrown, not swallowed, and the rows below surface it | mapped by `tax-error-handler.service.js` | `reapplyExistingCalculation()` catch block (`throw error`), `tax-calculator/src/services/tax-orchestrator.service.js` |
| &nbsp;&nbsp;↳ `taxes_calculation_failed`, `invalid_tax_location`, `customer_tax_location_invalid` or `shipping_address_invalid` | 400 `MissingTaxRateForCountry` | `tax-calculator/src/services/tax-error-handler.service.js:144-165` |
| &nbsp;&nbsp;↳ `stripe_tax_inactive` | 400 `InvalidInput` | `tax-calculator/src/services/tax-error-handler.service.js:168-183` |
| &nbsp;&nbsp;↳ another `StripeInvalidRequestError` / `StripeAPIError` | 500 `ExternalServiceError` | `tax-calculator/src/services/tax-error-handler.service.js:186-204` |
| &nbsp;&nbsp;↳ any other error type (auth, connection, rate limit, outage) | generic handler: the error's `statusCode`, else 500 | `tax-calculator/src/services/tax-error-handler.service.js:213-217` |

## Notes

- **Two actions are never emitted here:** `setLineItemTotalPrice` and `setCustomType` (the action list is
  assembled from only the line-item tax, shipping tax and cart-total actions in `reapplyExistingCalculation()`).
  The stored references, destination field and expiry stay as they were.
- **The destination guard compares the jurisdiction, not just the country:** it compares country + state +
  city + postal code via `createAddressKey()`.
- **Both sides of the guard come from the retrieved calculation and the current cart.** The stored side
  is the retrieved calculation's own `customer_details.address` (the address Stripe taxed), the current side
  is `extractCustomerAddress(cart)`; both are reduced by the same `createAddressKey()`. The cart custom field
  `connectorStripeTax_destinationCountry` is not read for this decision — it remains an informational
  record only.
- **`MissingTaxRateForCountry` is labelled with `cart.country`**, the price-selection country, not the
  destination (`tax-calculator/src/services/tax-error-handler.service.js:135`).
- **This is the only path on which Stripe error codes are mapped** — a *non-missing* `retrieve` error is
  re-thrown and surfaces through the mapping (a `resource_missing` / 404 recalculates instead, and a fresh
  calculation's provider errors never reach the mapping) (`business-rules/error-responses.md`
  Rule 6, *The re-apply path is the only one on which provider errors are mapped to specific responses*).
- **The scenario test is stricter than the trigger.** The trigger accepts the reference field when it is
  merely *defined*; the handler requires a non-empty list, so a defined-but-empty list would take the fresh
  path with a payment attached (`business-rules/tax-calculation.md` Rule 7, *Re-apply is chosen by a non-empty
  reference list, not by the field's presence*).
