# ADR-005 — In-Memory Category Cache to Reduce CT API Calls

**Status:** Accepted  
**Date:** 2024

## Context

Tax code resolution requires reading CT product categories to find the associated Stripe tax code. On every cart update, the connector may need to look up categories for all line items. CT categories change infrequently (merchant catalog management operations), but are read on every cart update.

Without caching, a cart with 10 line items in 5 different categories would generate 5+ CT API calls per cart update — multiplied by all concurrent shoppers.

## Decision

Cache CT product categories **in-memory with a 5-minute TTL** in the `CategoryService`.

The cache is keyed by category ID. On every tax calculation:
1. Check cache for each required category ID
2. If hit: use cached value
3. If miss: fetch from CT API, store in cache with TTL

The cache is **process-local** — each `tax-calculator` instance has its own cache. Cache invalidation happens only via TTL expiry (no explicit invalidation).

## Consequences

- CT category API calls are reduced dramatically for active carts — typical hit rate >95% for warm caches
- Category updates in CT take up to 5 minutes to propagate to tax code resolution — acceptable for catalog management operations
- In a multi-instance deployment, each instance has an independent cache — all instances will eventually converge within 5 minutes of a category update
- Memory footprint is bounded by catalog size — for large catalogs (>10,000 categories), consider reducing TTL or using an external cache
- No cache warming on startup — first requests after a cold start or TTL expiry may be slightly slower

## Alternatives Considered

| Option | Reason rejected |
|---|---|
| No cache (always fetch) | Too many CT API calls; latency risk under 2s API Extension timeout |
| Redis/external cache | Adds infrastructure dependency; overkill for category data that changes infrequently |
| Infinite TTL (cache forever) | Category updates would never propagate until process restart |
