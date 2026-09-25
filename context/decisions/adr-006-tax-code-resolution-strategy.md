# ADR-006: Tax code resolution strategy — no default, fail the cart update

**Status:** Accepted
**Date:** 2025-10-07 (decided) · 2026-09-11 (recorded)

## Context

The connector shipped with a hardcoded Stripe tax code (`txcd_99999999`, "General - Tangible
Goods") applied to every line item. That is a generic classification: it produces a plausible
number for most physical goods and a wrong one for anything with special treatment — food,
books, digital services, medical supplies — without anything in the response signalling that the
classification was a guess.

Replacing it raised a question the connector could not answer on its own: **what should happen
when a product in a taxable cart has no tax code configured?** The options were written up for the
client in `client-question-tax-code-strategy.md` (2025-10-07):

- **A — Fail the request.** Refuse to calculate; checkout blocked until the merchant configures
  the missing code.
- **B — Fall back to a configurable default.** Keep checkout moving, tax the item at whatever the
  merchant nominated as its catch-all.
- **C — Smart default, inferred from product type.** Guess a code from category names or product
  attributes.

The document recommended C. That recommendation was **not** what was built.

## Decision

**Option A. There is no default tax code. A line item with no resolvable tax code throws
`TaxCodeNotFoundError` and fails the entire cart update.**

Resolution is a single strategy: scan the categories directly assigned to the product and take the
first whose custom field `connectorStripeTax_TaxCode` is set.

## Alternatives Considered

| Alternative | Why discarded |
| --- | --- |
| B — configurable default | Moves an unresolved classification into a real charge. The merchant under- or over-collects silently, and the error surfaces at audit rather than at configuration time. A wrong tax code is not a degraded result; it is a compliance liability. |
| C — infer from product type (the document's own recommendation) | Inference from category names or attributes is a heuristic dressed as a rule. It fails quietly on exactly the catalogs that need it most — multilingual names, merchant-specific taxonomies, products in several categories — and produces a confident wrong answer instead of an error. |
| Keep `txcd_99999999` | Same failure as B, with no merchant control at all. |

## Consequences

**Positive:** A missing tax code is surfaced as a configuration error at the moment it matters,
not discovered in a tax filing. Every amount the connector writes back to commercetools traces to
a code the merchant chose deliberately.

**Negative:** Onboarding is strictly harder. A merchant cannot take a single order until every
category reachable from a purchasable product carries a tax code, and the failure is a blocked
cart — highly visible to the shopper, not just to the merchant.

**Risks:** A category added later without a tax code breaks checkout for the products in it, with
no warning until a shopper hits it. There is no pre-flight check that walks the catalog and
reports uncovered categories; adding one would convert a production outage into a configuration
report.

## Implementation notes

`tax-code.service.js` → `getTaxCodeForProduct()` calls `getCustomTypeCategoryTaxCode(categories)`
and throws `TaxCodeNotFoundError` when it returns `null`.

Three further strategies — product/line-item custom fields, the `TAX_CODE_CATEGORY_MAPPING_JSON`
mapping, and parent-category traversal — are present in the same function but **commented out**
(lines ~44-62). They are not part of this decision and are not reachable. Documentation that
described a live "5-strategy hierarchy" was incorrect and has been corrected in
`tax-calculator/README.md`; `context/business-rules/tax-code-resolution.md` Rule 2 already
recorded the limitation.

Note that `TAX_CODE_CATEGORY_MAPPING_JSON` remains a declared environment variable and is
validated at startup even though the strategy that consumes it is disabled. Setting it has no
effect on resolution today.

## Provenance

This ADR was written on 2026-09-11 from the implemented code, to close a gap: the decision was
made and built in October 2025 but never recorded, leaving only the pre-decision question document
at the repository root. That document has been removed — this ADR replaces it. Where the two
disagree, this one describes what runs.
