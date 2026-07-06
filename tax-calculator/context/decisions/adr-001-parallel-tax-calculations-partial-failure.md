# ADR-001: Parallel Stripe tax calculations per ship-from/shipping-method group with partial-failure tolerance

**Status:** Accepted
**Date:** 2026-07-06

> Reconstructed from observed code behavior (`src/services/tax-orchestrator.service.js:546`), not from a documented historical decision. Alternatives and Risks below are partly placeholders for human fill-in.

## Context

A cart can span multiple ship-from origins and multiple shipping methods, each requiring its own Stripe `tax.calculations.create` call. Calling Stripe sequentially would make the CT API Extension (2000ms timeout) prone to timing out on larger carts.

## Decision

Issue all `tax.calculations.create` calls in parallel, one per ship-from / shipping-method group, and collect results with `Promise.allSettled`. Failed calculations are logged as `warn` and dropped; the request throws only if every calculation fails.

## Alternatives Considered

| Alternative | Why discarded |
| --- | --- |
| Sequential calls | Risk of exceeding the 2000ms extension timeout on multi-group carts. |
| `Promise.all` (fail-fast) | One failing group would fail the entire cart — _(placeholder: confirm whether availability was deliberately preferred over correctness)_. |
| Fail the request on any partial failure | _(placeholder: not chosen; needs human rationale — likely availability preference)_ |

## Consequences

**Positive:** Latency stays bounded by the slowest single group; a single group's failure does not block the whole cart.
**Negative:** A partial failure yields a cart with tax computed only for the successful groups.
**Risks:** **Under-reported tax on partial failure** — dropped groups are silently excluded, a tax-compliance risk (see `context/known-issues.md` Issue 2). A human decision is needed on whether partial failure should instead surface an error or fail the request.
