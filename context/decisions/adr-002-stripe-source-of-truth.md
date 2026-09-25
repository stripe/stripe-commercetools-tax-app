# ADR-002 — Stripe as Source of Truth for Tax Calculation

**Status:** Accepted  
**Date:** 2024

## Context

Tax calculation could be done locally (using tax rate tables maintained by the merchant) or delegated entirely to Stripe Tax. Stripe Tax maintains up-to-date tax rules for 40+ countries and US states, handling nexus determination, rate lookups, and exemptions automatically.

## Decision

**Stripe Tax is the source of truth for all tax calculations.** The connector never stores tax rates locally or applies its own calculation logic. Every CT cart update triggers a `stripe.tax.calculations.create()` call, and CT is updated with the result.

Each Stripe `taxcalc_xxx` Calculation ID is stored on the CT order's custom field set `connectorStripeTax_calculationReferences` (a `Set of String`, because a cart can produce multiple calculations — one per ship-from group × shipping method). When an order is created, the order-syncer iterates the set and passes each ID to `stripe.tax.transactions.createFromCalculation()` to lock the transaction. The resulting transaction IDs are written back to `connectorStripeTax_transactionReferences`.

## Consequences

- Tax rules (rates, exemptions, nexus) are always current — no manual maintenance required
- The connector is entirely dependent on Stripe Tax API availability; if Stripe is down, tax calculation fails and the cart update is blocked
- The CT API Extension has a **2-second timeout** — Stripe Tax calls must complete within this window
- Tax calculation results are ephemeral in Stripe (Calculations expire) — the `taxcalc_xxx` ID must be used to create a Transaction before it expires
- Merchants must configure Stripe Tax settings (product tax codes, nexus registrations) in the Stripe Dashboard — not in this connector

## Alternatives Considered

| Option | Reason rejected |
|---|---|
| Local tax table | Requires constant maintenance; incorrect rates create legal liability |
| Third-party tax provider (Avalara, TaxJar) | Adds another vendor; Stripe Tax is already included in the Stripe relationship |
| Pre-calculated taxes in CT | Cannot handle dynamic address changes during checkout |
