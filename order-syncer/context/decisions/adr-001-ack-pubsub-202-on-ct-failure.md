# ADR-001: Acknowledge Pub/Sub messages with HTTP 202 even on commercetools API failure

**Status:** Accepted
**Date:** 2026-07-06

> Note: This ADR was reconstructed from observed code behavior, not from a real historical decision record. The Context and Decision below are inferred from what the code does; the Alternatives and some Risks are placeholders for a human to complete or correct.

## Context

`order-syncer` processes commercetools `OrderCreated` events delivered as Google Pub/Sub push messages. When a CT `getOrder` or order-update call fails, the CT clients re-throw a `CustomError` with `statusCode 202`, and the controller returns HTTP 202 (Accepted) to Pub/Sub (src/clients/query.client.js:20, src/clients/update.client.js:34, src/controllers/sync.controller.js:58). Because Pub/Sub treats a 2xx response as a successful acknowledgment, returning 202 stops redelivery of that message. The apparent motivation is to avoid Pub/Sub redelivery storms and repeated failing work when CT is temporarily unavailable or the order is not in a syncable state.

## Decision

Map CT read/write failures to HTTP 202 so Pub/Sub acknowledges the message and does not retry, rather than returning a 5xx that would trigger redelivery.

## Alternatives Considered

| Alternative | Why discarded |
| --- | --- |
| Return 5xx on CT failure so Pub/Sub retries | _(placeholder — human to fill in: retry storms vs. eventual recovery trade-off)_ |
| Dead-letter / retry queue with bounded backoff | _(placeholder — human to fill in)_ |
| Distinguish transient vs. permanent CT errors and only ack the permanent ones | _(placeholder — human to fill in)_ |

## Consequences

**Positive:** Avoids Pub/Sub redelivery storms and repeated failing work against a struggling CT API; keeps the handler responsive.
**Negative:** A genuine CT failure is acknowledged as success; the tax sync for that order is not retried by the platform.
**Risks:** Silent sync loss — an order can be marked "handled" (message acked) while no transaction reference was written and no alert is raised. See known-issues Issue 2. Because this ADR is reconstructed from code, confirm the intended retry semantics with the original authors before relying on this behavior.
