# commercetools Stripe Tax Connector — Host Integration

> Who this is for: developers of an application that calls this connector at runtime.
> To install and run the connector itself, see `adopter-guide.md`.

This connector is driven almost entirely by commercetools: the cart extension and the order
subscription have the platform as their only caller, and they are covered in `adopter-guide.md`.
One route has no platform caller: the address check. This document covers that route only.

## 1. Integration paths

| Path | How the host reaches the unit | Caller | Status | Source |
| --- | --- | --- | --- | --- |
| Address check | `POST {tax-calculator deployment URL}/validateAddress` — with the manifest's endpoint, `https://{connect-provided-host}/taxCalculator/validateAddress` | unknown — host backend or host browser | unknown | Route: `tax-calculator/src/index.js:20-21`, `tax-calculator/src/routes/address.validation.route.js:6-9`. Documented only in the unit's own README (`tax-calculator/README.md:138-164`) |

There is one path, and its status is **unknown**: nothing in this repository calls it, and no
platform or provider documentation describes it — only the connector's own README does. Who
actually calls it is the first item in §7.

**Not a host path:** `POST /taxCalculator` is the cart extension's handler. Its caller is
commercetools (`tax-calculator/src/connectors/action.js:21-35`); a host must not call it.

## 2. Before the first call

| What the host needs | Where it comes from | Who creates it | Lifetime / scope |
| --- | --- | --- | --- |
| The `tax-calculator` deployment URL | The Connect deployment. Connect assigns "Deployment URL endpoint … in the format `{connect-provided-url}/{endpoint}`" (external — docs.commercetools.com/connect/development; confirmed 2026-10); the endpoint is `/taxCalculator` (`connect.yaml:4`) | operator | the deployment; a redeploy may change it |
| A credential | **None required.** | — | — |
| `x-request-id` header | optional; used only to correlate log lines (`tax-calculator/src/controllers/address.validation.controller.js:15`) | host | per request |

The full route is the deployment URL plus `/validateAddress`: the app mounts both routers under
`/taxCalculator` (`tax-calculator/src/index.js:20-21`). Connect calls that deployment URL "the public
URL of the Connect application" (external — docs.commercetools.com/connect/automation-scripts,
`CONNECT_SERVICE_URL`; confirmed 2026-10).

## 3. Calls

### 3a. Calls the host makes

#### Validate an address

- **To:** `POST {deployment URL}/validateAddress` · **From:** host backend or browser (unknown — §1)
- **Auth:** none
- **Request** — JSON body with one object, `address`. Fields read: `line1`, `line2`, `city`,
  `state`, `postal_code`, `country` (`tax-calculator/src/services/address.service.js:150-158`):
  ```
  POST /taxCalculator/validateAddress
  Content-Type: application/json

  { "address": { "line1": "123 Main St", "city": "San Francisco", "state": "CA",
                 "postal_code": "94105", "country": "US" } }
  ```
  The body is an address only; nothing ties it to a cart or a customer, and the result is not
  stored in commercetools.
- **What the unit does:** shape check → local rules → Stripe probe, the probe only if the local
  rules pass (`tax-calculator/src/services/address.service.js:21-73`).
  - Local rules (`tax-calculator/src/validators/address.validator.js:3-24,151-205`): `country` must be
    ISO 3166-1 alpha-2. **US** requires `line1`, `city`, `state`, `postal_code`, with a 5- or 9-digit
    postal code and a state from the US list; **CA** checks the postal format and province code when
    present; **IN** needs `postal_code` or `state`; every other country needs only `country`.
    `line1` ≤ 200 and `city` ≤ 100 characters.
  - Stripe probe: one calculation with a single 100-unit line item, tax code `txcd_99999999`,
    reference `address-verification`, `address_source: shipping`, in the country's currency (a
    built-in map of 24 countries) or else `ADDRESS_VALIDATION_STRIPE_DEFAULT_CURRENCY`, default `usd`
    (`tax-calculator/src/services/address.service.js:135-168,281-310`).
- **Response — accepted** (200):
  ```
  { "success": true,
    "validation": { "local": { "isValid": true, "errors": [] }, "stripe": { "accepted": true } },
    "address": { "suggestions": [] } }
  ```
  The accepted response status is 200.
- **Response — local rules failed** (400; Stripe is not called, so `stripe` is `null`). Request
  without `state` for a US address:
  ```
  { "success": false,
    "validation": { "local": { "isValid": false,
                               "errors": [ { "code": "MISSING_STATE",
                                             "message": "state is required for US tax calculation" } ] },
                    "stripe": null },
    "address": { "suggestions": [ { "field": "state",
                                    "message": "The field \"state\" is required for US",
                                    "required": true } ] } }
  ```
  `suggestions` is built from the local errors: `INVALID_POSTAL_CODE` and `INVALID_STATE` carry an
  `example`, and any `MISSING_*` code names the field (`address.service.js:215-244`).
- **Response — Stripe rejected the probe** (400):
  ```
  { "success": false,
    "validation": { "local": { "isValid": true, "errors": [] },
                    "stripe": { "accepted": false, "code": "customer_tax_location_invalid",
                                "userMessage": "The address cannot be used for tax calculation. Please verify the address is correct.",
                                "actionable": { "action": "Verify the address is complete and correct",
                                                "steps": [ "…" ] } } },
    "address": { "suggestions": [] } }
  ```
  `code` is Stripe's error code, or `STRIPE_ERROR` when it has none. Friendly messages exist for
  `customer_tax_location_invalid`, `shipping_address_invalid`, `invalid_tax_location`,
  `taxes_calculation_failed`, `stripe_tax_inactive`; `actionable` only for the first, second and
  last (`address.service.js:319-371`). All five codes are Stripe error codes (external —
  docs.stripe.com/error-codes; confirmed 2026-10).
- **Errors the host sees, and what each means:**

  | Status | Body | Means |
  | --- | --- | --- |
  | 400 | `{ "error": "Address is required in request body" }` | no `address` in the body (`address.validation.controller.js:21-25`) |
  | 400 | `{ "error": "Address must be a valid object" }` | `address` is not an object, or is an array (`:27-31`) |
  | 400 | the `success: false` bodies above | local rules failed, or Stripe rejected the probe — read `validation.local` and `validation.stripe` to tell which |
  | 500 | `{ "error": "An unexpected error occurred during address validation", "message": "…" }` | an unexpected error during validation |

  Do not show the `userMessage` or the 500 `message` to shoppers verbatim. The connector's errors
  never come back as commercetools error objects on this route; that format is only for the cart
  extension.

### 3b. Calls the unit's component makes from the host's page

Not applicable — the connector ships no browser component.

## 4. The surface the host drives

Not applicable — the connector ships no bundle, client library, component or extension point. The
only host-facing surface is the HTTP route in §3.

## 5. Outcome

The answer is synchronous and final: there is no callback, no event and no later state.

| `success` | `validation.stripe` | Means |
| --- | --- | --- |
| `true` | `{ "accepted": true }` | the local rules passed and Stripe created a calculation for the address without error |
| `false` | `null` | the local rules failed; Stripe was not called — fix the fields named in `errors` / `suggestions` |
| `false` | `{ "accepted": false, … }` | the local rules passed and Stripe rejected the address — `code` says why |

**What `accepted: true` does not mean.** It means Stripe accepted the address as a calculation
input. It does not mean tax will be non-zero: Stripe calculates tax only where the account has an
active tax registration, and returns zero tax for a customer location without one (external —
docs.stripe.com/tax/custom; confirmed 2026-10). And it does not mean the cart will calculate: the
cart extension never calls this route, applies none of these local rules, and has its own refusal —
a delivery address with a city, postal code or street but no country is rejected (`adopter-guide.md`
§4).

**Who does what next.** The unit does nothing further: it writes nothing to commercetools, and the
probe calculation stays at Stripe, unreferenced — its ID is only logged at debug level
(`tax-calculator/src/services/address.service.js:170-173`). Everything after the answer — showing
errors, blocking checkout, setting the address on the cart — is the host's.

## 6. Running a host locally against a deployed unit

- **No allowed-origins setting exists.** The app registers no CORS handling
  (`tax-calculator/src/index.js:13-21`; no CORS package in `tax-calculator/package.json`). Whether a
  browser page on another origin can call the route is therefore decided by the browser, not by
  anything configurable here — see §7.
- **Calls cost the same from a local host.** Every accepted probe is a calculation on whichever
  Stripe account the deployment's `STRIPE_API_TOKEN` belongs to; point local development at a
  deployment configured with a test-mode key. The caller decides how often the route is called —
  debounce on input.
- **Running the unit itself locally** (for a host developer who wants no deployment):
  `npm run start` in `tax-calculator/` serves on port 8080 (`tax-calculator/package.json:8`,
  `tax-calculator/src/index.js:10`), so the route is `http://localhost:8080/taxCalculator/validateAddress`.
  `STRIPE_API_TOKEN` must be in the environment or a `.env` file before start: the address check's
  Stripe client is built when the module loads (`tax-calculator/src/services/address.service.js:5`;
  `dotenv/config` at `tax-calculator/src/index.js:1`).

## 7. Not covered

- **Who calls this route.** No caller exists in this repository. Until a caller is identified, §1's
  status stays `unknown`.
- Whether the deployment URL is stable across redeploys.
- How Stripe counts or bills the probe calculations (`reference/stripe-tax-api.md`, Constraints).
- Whether a browser on another origin can call the route, given that no CORS headers are set.
- Rate limits, on the connector's or Stripe's side.
- Whether a host should rely on this check at all, given that the cart path does not use it.
