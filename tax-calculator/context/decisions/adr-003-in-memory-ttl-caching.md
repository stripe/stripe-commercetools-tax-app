# ADR-003: In-memory 5-minute TTL caching for CT lookups

**Status:** Accepted
**Date:** 2026-07-06

> Reconstructed from observed code behavior across the service files, not from a documented historical decision.

## Context

Each tax calculation triggers many commercetools lookups (product categories, ship-from channel/inventory addresses, tax codes, tax-behavior config), and the CT API Extension can fire repeatedly as a shopper edits a cart. Re-reading CT for every lookup multiplies API call volume and latency against the 2000ms extension timeout.

## Decision

Cache category, ship-from, tax-code, and tax-behavior lookups in process memory with a 5-minute TTL (`5*60*1000` ms).

## Alternatives Considered

| Alternative | Why discarded |
| --- | --- |
| No caching | Higher CT API volume and latency per cart; risk of extension timeout. |
| Shared/external cache (e.g. Redis) | _(placeholder: added infrastructure not warranted for per-instance ephemeral data; confirm with human)_ |
| Shorter TTL | _(placeholder: trades staleness for call volume; 5 min chosen — needs human rationale)_ |

## Consequences

**Positive:** Fewer CT API calls per cart; lower latency, less timeout risk.
**Negative:** Cached values can be stale for up to 5 minutes.
**Risks:** After a merchant updates a category tax code, a ship-from channel address, or tax-behavior config, the service can keep applying the old value for up to 5 minutes with no indication of staleness (see `context/business-rules/tax-code-resolution.md` Rule 2).
