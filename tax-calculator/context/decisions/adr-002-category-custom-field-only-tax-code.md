# ADR-002: Category-custom-type-field-only tax code resolution

**Status:** Accepted
**Date:** 2026-07-06

> Reconstructed from observed code behavior (`src/services/tax-code.service.js:36-69`), not from a documented historical decision.

## Context

The tax-code resolution service was written with four strategies: (1) category custom-type field, (2) product custom field, (3) `TAX_CODE_CATEGORY_MAPPING_JSON` category mapping, (4) parent-category traversal. Only strategy 1 is currently active; strategies 2-4 are commented out. The `TAX_CODE_CATEGORY_MAPPING_JSON` config is still validated at post-deploy and loaded by `taxCodeMapping.config.js`, but never read at runtime.

## Decision

Resolve each product's Stripe tax code exclusively from the `connectorStripeTax_TaxCode` custom field on its commercetools category. A product whose category lacks that field throws `TaxCodeNotFoundError`.

## Alternatives Considered

| Alternative | Why discarded |
| --- | --- |
| Keep all four strategies live | _(placeholder: likely a deliberate simplification to a single deterministic source; confirm with human)_ |
| Remove the dead strategies and config entirely | Not done — dead code and unused config remain, suggesting cleanup was never finished. |

## Consequences

**Positive:** A single, deterministic tax-code source is easy to reason about and audit.
**Negative:** The configuration surface is misleading — `TAX_CODE_CATEGORY_MAPPING_JSON` appears supported (validated at deploy) but has no runtime effect (see `context/known-issues.md` Issue 1).
**Risks:** Operators may configure the JSON mapping and still see `TaxCodeNotFoundError`. **Human decision needed:** either remove the dead strategies 2-4 and the unused config, or re-enable them so the config surface matches actual behavior.
