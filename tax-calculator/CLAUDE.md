# tax-calculator

## Overview

`tax-calculator` is a JavaScript (ESM) Express **service** inside the client-owned tax connector `stripe-commercetools-tax-app` (integration `commercetools-stripe-integration`). It is invoked synchronously by a commercetools API Extension on cart Create/Update — but only for carts where `taxMode="ExternalAmount"` (`src/connectors/action.js:31-34`, 2000ms timeout). It receives the CT cart, resolves a Stripe tax code per line item and a ship-from origin per shipment, calls Stripe Tax `tax.calculations.create` in parallel per ship-from/shipping-method group, and returns commercetools cart update actions carrying the resulting tax rates. It also exposes `POST /taxCalculator/validateAddress`, which probes Stripe Tax with a $1.00 test calculation. It is standalone — no relative imports to or from the sibling `order-syncer` module.

## Structure

```
tax-calculator/
  src/
    index.js                       HTTP bootstrap (hardcoded port 8080)
    routes/                        tax.calculator.route.js, address.validation.route.js
    controllers/                   tax + address-validation request handlers
    services/
      tax-orchestrator.service.js  main flow (category → ship-from → tax-code → Stripe → actions)
      category.service.js          CT category fetch (batched, cached)
      ship-from.service.js         channel → inventory → default ship-from chain (cached)
      tax-code.service.js          tax code from category custom field (cached)
      tax-behavior.service.js      tax_behavior resolution (cached)
      address.service.js           address validation via Stripe test calc
      update-action.service.js     builds CT cart update actions
    connectors/                    post-deploy.js, pre-undeploy.js, action.js, customTypes.js
    validators/  config/  errors/  middlewares/  clients/  utils/
  resources/  test/
```

## Before Every Task

Read in this order:

1. This file (`CLAUDE.md`).
2. `context/ARCHITECTURE.md` — entry points, directory map, dependencies, configuration.
3. `context/known-issues.md` — the 16 documented gaps (read before changing any flow).
4. `context/business-rules/` — tax-code-resolution, ship-from-resolution.
5. `context/workflows/` — process-tax-calculation, process-address-validation.

## Coding Rules

- **Tax-code resolution has three dead strategies.** Only the category custom-type field (`connectorStripeTax_TaxCode`) is live. Do not assume `TAX_CODE_CATEGORY_MAPPING_JSON`, product custom fields, or parent-category traversal are consulted at runtime — verify against `src/services/tax-code.service.js:36-69` first (Issue 1).
- **Cached lookups are stale for up to 5 minutes** (category / ship-from / tax-code / tax-behavior). Account for this lag when reasoning about config or data changes.
- **Ship-from and category failures are swallowed** (return null / skip batch). A CT transient error silently changes the tax result — do not treat a successful response as proof the origin/category was resolved correctly (Issues 5, 6).
- **Monetary amounts:** CT uses integer cents; Stripe uses its own units. Convert at the boundary; never write a non-integer `centAmount`.
- **Hardcoded fallbacks exist** (country `'US'`, currency `'USD'`, shipping `tax_behavior='exclusive'`, port `8080`). Confirm these against the Module Map / `context/known-issues.md` before assuming behavior for a non-US merchant (Issues 11, 12).

## What Claude Must Never Do

- **Never present `TAX_CODE_CATEGORY_MAPPING_JSON` (or product-field / parent-category) tax-code strategies as working.** They are dead code; the config is validated at deploy but never used at runtime. Advising a merchant to rely on it would be wrong (Issue 1).
- **Never treat a successful tax-calculation response as complete.** Partial Stripe failures are dropped silently and the returned update actions can under-report tax — a compliance risk. Do not remove or weaken any check that surfaces partial failure (Issue 2).
- **Never expose `/taxCalculator/validateAddress` (or the tax endpoint) to a merchant UI without adding request authentication.** Both endpoints currently have no JWT/HMAC verification, violating the hub rule for merchant-callable endpoints (Issues 3, 4).
- **Never compute or default financial amounts, jurisdictions, or currencies client-side or in a UI.** All Stripe Tax calls go through this backend service.
