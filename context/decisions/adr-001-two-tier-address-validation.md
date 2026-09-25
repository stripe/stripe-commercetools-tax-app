# ADR-001 — Two-Tier Address Validation

**Status:** Accepted  
**Date:** 2024

## Context

Stripe Tax requires valid, recognized addresses to calculate taxes. Invalid or incomplete addresses cause Stripe API errors that would be surfaced to the shopper during checkout — a poor UX.

However, calling Stripe for every address validation would add latency and consume API quota for addresses that fail basic format checks.

## Decision

Implement **two-tier address validation**:

1. **Tier 1 — Local rules** (fast, no API call): Check for required fields (country, postal code format, state for US/CA), unsupported territories, and missing required components. Country-specific rule definitions and the `validateAddress(address)` validator live in `tax-calculator/src/validators/address.validator.js`; the service entry point is `address.service.js → performLocalValidation()`, which delegates to the validator. A preflight `validateAddressStructure()` (also in the service) gates basic shape checks before local validation runs.

2. **Tier 2 — Stripe verification** (API call): `address.service.js → verifyAddressWithStripe()` posts a minimal `stripe.tax.calculations.create()` request (amount 100 cents, `tax_code: 'txcd_99999999'`, `address_source: 'shipping'`). If Stripe rejects the address, the service maps the error code to a user-friendly message via `getUserFriendlyMessage()` / `getActionableGuidance()` and returns a structured rejection — it does not throw.

Tier 1 is always executed first. Tier 2 only runs if Tier 1 passes.

## Consequences

- Addresses that fail basic validation are rejected immediately without an API call — faster feedback and lower Stripe quota usage
- Addresses that pass local rules but fail Stripe validation still surface an error (e.g., unrecognized postal code in a valid format)
- Unsupported territories (defined in the connector config) are rejected at Tier 1 without hitting Stripe
- Local validation rules must be kept in sync with Stripe's supported address requirements — if Stripe expands support, Tier 1 must be updated

## Alternatives Considered

| Option | Reason rejected |
|---|---|
| Stripe-only validation | Every address change during checkout hits the Stripe API; too slow and expensive |
| Local-only validation | Some invalid addresses pass local checks but fail Stripe; would result in runtime errors during tax calculation |
