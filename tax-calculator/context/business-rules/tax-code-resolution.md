# Tax Code Resolution

How the service determines which Stripe tax code applies to each product, and the caching that governs the lookups.

## Rule 1: Tax code comes only from the category custom-type field

**What:** Every product's Stripe tax code is resolved solely from the `connectorStripeTax_TaxCode` custom field on the product's commercetools category. The three other strategies in the code (product custom field, `TAX_CODE_CATEGORY_MAPPING_JSON` category mapping, parent-category traversal) are commented out and never execute.
**Why:** STRATEGY 1 was kept active while strategies 2-4 were commented out (a simplification that was never cleaned up). The effective, as-implemented rule is far narrower than the config surface implies.
**Invariant:** For every line item taxed, the product's own category carries a non-empty `connectorStripeTax_TaxCode` custom field; otherwise resolution throws `TaxCodeNotFoundError`. `TAX_CODE_CATEGORY_MAPPING_JSON` does not affect resolution.
**Implementation:** `src/services/tax-code.service.js:36-69` (active strategy 1; strategies 2-4 commented out); config loaded but unused at `src/config/taxCodeMapping.config.js:24`.
**Closure criterion:** `grep -n "STRATEGY" src/services/tax-code.service.js` shows strategies 2-4 commented; `grep -rn "TAX_CODE_CATEGORY_MAPPING_JSON" src/services/` returns no runtime read in the resolution path.
**What breaks if violated:** A product whose category lacks the custom field throws `TaxCodeNotFoundError` and its tax cannot be calculated — even if a valid `TAX_CODE_CATEGORY_MAPPING_JSON` entry exists for it. Operators who configure the JSON mapping expecting it to work are misled (see `context/known-issues.md` Issue 1).

---

## Rule 2: Lookups are cached in memory for 5 minutes

**What:** Category, ship-from, tax-code, and tax-behavior lookups are cached in process memory with a 5-minute TTL (`5*60*1000` ms).
**Why:** To reduce commercetools API call volume, since a single cart triggers many category/tax-code lookups and the extension can fire repeatedly during cart edits.
**Invariant:** A resolved value is reused for up to 5 minutes before the source (CT category custom field, channel address, etc.) is re-read.
**Implementation:** `src/services/category.service.js:24`; `src/services/ship-from.service.js:15`; `src/services/tax-code.service.js:19`; `src/services/tax-behavior.service.js:11`.
**Closure criterion:** `grep -n "5 \* 60 \* 1000\|5\*60\*1000" src/services/*.service.js` shows the TTL in all four services.
**What breaks if violated:** After a merchant updates a category's tax code, a ship-from channel address, or tax-behavior config, the service can continue applying the old value for up to 5 minutes, producing stale (and potentially non-compliant) tax results with no indication of staleness.
