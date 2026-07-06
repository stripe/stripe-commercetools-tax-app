# Process Address Validation

**Trigger:** `POST /taxCalculator/validateAddress` with `body.address` (`src/routes/address.validation.route.js:6`).
**Modules involved:** tax-calculator only.
**Outcome:** Returns the full validation result `{ success, validation: { local, stripe }, address: { suggestions } }` (`buildValidationResult`, `src/services/address.service.js:196-205`). The controller responds HTTP 400 when `success` is false and HTTP 200 (`HTTP_STATUS_SUCCESS_ACCEPTED`) otherwise, sending that same object either way. `accepted` is not the top-level response — it appears only nested at `validation.stripe.accepted`.

## Happy Path

1. Route receives the POST and passes the request to the controller — `src/routes/address.validation.route.js:6`.
2. Controller extracts `body.address` and calls the address service — `src/controllers/address.validation.controller.js:14`.
3. Address service builds a test Stripe tax calculation: amount `100` (i.e. $1.00), default tax code `txcd_99999999`, `address_source='shipping'`, currency from `ADDRESS_VALIDATION_STRIPE_DEFAULT_CURRENCY` (default `'usd'`) or the hardcoded country→currency map — `src/services/address.service.js:138,159,163,165,282-308`.
4. Address service calls `tax.calculations.create` — `src/services/address.service.js:148`.
5. The service assembles the result via `buildValidationResult` — `{ success, validation: { local, stripe }, address: { suggestions } }` — where `success` is true only if local validation passes and (when Stripe was consulted) `validation.stripe.accepted === true` — `src/services/address.service.js:188-205`. The internal `verifyAddressWithStripe` helper returns `{ accepted: true }` on a successful test calc and `{ accepted: false }` when Stripe errors (not re-thrown), and that value is nested under `validation.stripe` — `src/services/address.service.js:148,176`. The controller then returns HTTP 400 with the full object when `success` is false, or HTTP 200 (`HTTP_STATUS_SUCCESS_ACCEPTED`) with the full object otherwise — `src/controllers/address.validation.controller.js:51-55`.

## Error Paths

| Condition | Behavior | File |
| --- | --- | --- |
| Stripe rejects / errors on the test calculation | Caught, returned as `{ accepted: false }` (not re-thrown) | `src/services/address.service.js:148` |
| `STRIPE_API_TOKEN` unset | Stripe client still created at import time; fails at the call | `src/services/address.service.js:5` |

## Notes

- **No authentication (HIGH):** this endpoint has no request auth. If reachable from a merchant UI it violates the hub JWT rule and exposes an unauthenticated Stripe-calling endpoint (`context/known-issues.md` Issue 3).
- The Stripe client for this service is instantiated at import time directly from `process.env.STRIPE_API_TOKEN`, bypassing the validated config path used elsewhere (`context/known-issues.md` Issue 8).
- The tax code `txcd_99999999` and amount `100` are hardcoded and used only to make Stripe evaluate the address; they are not derived from any cart.
