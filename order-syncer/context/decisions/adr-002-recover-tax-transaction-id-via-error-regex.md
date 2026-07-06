# ADR-002: Recover existing Stripe tax transaction IDs by regex-parsing the duplicate-commit error

**Status:** Accepted
**Date:** 2026-07-06

> Note: This ADR was reconstructed from observed code behavior, not from a real historical decision record. The Context and Decision below are inferred from what the code does; the Alternatives and some Risks are placeholders for a human to complete or correct.

## Context

Pub/Sub can redeliver the same `OrderCreated` event, so `order-syncer` may attempt to commit a Stripe tax calculation that was already committed. When that happens, `tax.transactions.createFromCalculation` rejects the duplicate. Rather than tracking committed-transaction state in commercetools and consulting it before committing, the single-calc path swallows the Stripe error and recovers the already-existing transaction ID by matching the regex `/tax transaction (tax_\w+)/` against the Stripe error message text (src/extensions/stripe/clients/client.js:29-38, regex at :38). This makes a re-commit behave like a no-op that still yields a transaction ID to write back.

## Decision

On a duplicate calculation commit, extract the existing tax transaction ID from Stripe's error message via regex, instead of persisting and re-reading commit state from CT.

## Alternatives Considered

| Alternative | Why discarded |
| --- | --- |
| Persist committed transaction IDs in CT and check before committing | _(placeholder — human to fill in: extra CT round-trips / state management)_ |
| Read the existing transaction from a structured Stripe field/response instead of the error text | _(placeholder — human to fill in: whether Stripe returns a structured reference on duplicate)_ |
| Use a Stripe idempotency key so re-commit returns the original transaction | _(placeholder — human to fill in)_ |

## Consequences

**Positive:** Requires no additional CT state and makes retried deliveries idempotent in the common case with minimal code.
**Negative:** Correctness depends on Stripe's human-readable error wording remaining stable.
**Risks:** If Stripe changes the error copy, the regex captures `undefined`; the order is marked synced with no valid transaction reference and no error is surfaced — a tax compliance/correctness hazard. See known-issues Issue 1. Because this ADR is reconstructed from code, confirm the intended idempotency strategy with the original authors before extending this pattern.
