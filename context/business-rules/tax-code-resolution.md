# Business Rule: Tax Code Resolution

## Overview

Every line item sent to Stripe Tax must have a tax code (`txcd_XXXXXXXX`). Tax codes determine how Stripe classifies the product for tax purposes. The connector resolves tax codes through a hierarchical lookup on CT product categories.

---

## Rule 1: Tax code is required — missing code fails the cart update

**What:** If `taxCodeService.getTaxCodeForProduct()` cannot find a tax code for a line item, it throws `TaxCodeNotFoundError`, which propagates up and fails the entire tax calculation for that cart update.

**Why:** Stripe Tax cannot calculate tax without knowing what type of product is being sold. Sending a request without a tax code would either fail at Stripe or return incorrect tax (using a default that may not apply).

**Invariant:** Every product in a taxable cart must have a resolvable tax code. This is a configuration requirement, not a runtime fallback. Merchants must configure tax codes on their CT categories.

**Implementation:** `tax-code.service.js` → `getTaxCodeForProduct()` — throws if no code found.

**What breaks if violated:** If a fallback default were used instead, products would be taxed at the wrong rate. A missing tax code is a configuration error that must be surfaced immediately, not silently defaulted.

---

## Rule 2: Tax code is resolved by scanning each direct category's custom field — first match wins

**What:** For a given line item, the service iterates over the categories directly assigned to the product and returns the first category whose custom field `connectorStripeTax_TaxCode` is set. There is no parent-hierarchy walk in the active code path: `getCustomTypeCategoryTaxCode()` only inspects the categories returned for the product. (The strategies that would also check line-item/variant custom fields, the `TAX_CODE_CATEGORY_MAPPING_JSON` mapping, and parent-chain traversal are present but commented out in `getTaxCodeForProduct`.)

**Why:** Merchants assign products to leaf or near-leaf categories. The first-found scan keeps resolution deterministic and avoids the cost/complexity of recursing through parent references that may not be expanded.

**Invariant:** The custom-type field name is always `connectorStripeTax_TaxCode` (the constant `TAX_CODE_CUSTOM_TYPE_NAME`). The order of categories in the line-item's `productCategories` array determines tie-breaking — first non-empty value wins.

**Implementation:** `tax-code.service.js` → `getTaxCodeForProduct()` calls `getCustomTypeCategoryTaxCode(categories)` only; if it returns `null`, the service throws `TaxCodeNotFoundError`. `categoryService.getCategoriesForProducts()` retrieves the categories with `expand: ['categories[*]']` via Product Projections.

**Note — limitation:** Documentation previously described a four-strategy fallback (line-item custom field → product mapping JSON → parent-category traversal). Those branches exist as commented-out code in `tax-code.service.js` (lines ~44-62). To re-enable hierarchical traversal or product-level overrides, those strategies would need to be uncommented and the supporting `findFirstTaxCodeInHierarchy` / `taxCodeMappingConfig` paths re-tested.

**What breaks if violated:** Renaming the field constant or skipping the scan would silently fall through to `TaxCodeNotFoundError`, blocking tax calculation for every product.

---

## Rule 3: Category data is cached for 5 minutes

**What:** `categoryService.getCategoriesForProducts()` fetches all required categories in a single CT API call and caches the result for 300 seconds. Subsequent calls within the cache window return the cached data.

**Why:** Category data changes rarely. Fetching categories on every cart update would consume CT API rate limits and add latency that contributes to the 2-second timeout risk.

**Invariant:** The cache TTL is 5 minutes. Never reduce it to zero or bypass the cache under normal operation. If a merchant updates a category's tax code, the change takes up to 5 minutes to propagate to tax calculations.

**Implementation:** `category.service.js` — in-memory cache with 5-min TTL.

**What breaks if violated:** Without caching, category fetches add ~100-300ms to every cart update, pushing total execution closer to the 2-second CT timeout.

---

## Rule 4: Shipping tax code comes from the shipping method, not from line item categories

**What:** The tax code for shipping costs is read from the shipping method's custom field `connectorStripeTax_TaxCode`, not from any product category. The shipping method is fetched via `apiRoot.shippingMethods().withId(...)` (cached for 5 minutes per `shippingMethodId`). If no code is configured on the shipping method, `getShippingTaxCodeFromShippingInfo()` returns `null`, and the orchestrator omits `shipping_cost.tax_code` in the Stripe request — Stripe uses its default.

**Why:** Shipping is not a product — it has its own tax classification separate from the items being shipped. In many jurisdictions, shipping is taxed differently from goods.

**Invariant:** Never use a product tax code for shipping. Never use a shipping tax code for products. They are resolved from different sources but use the same field name (`connectorStripeTax_TaxCode`) on different resource types.

**Implementation:** `tax-code.service.js` → `getShippingTaxCodeFromShippingInfo(shippingInfo)` → `getShippingMethodById(id)` (cached) → reads `shippingMethod.custom.fields.connectorStripeTax_TaxCode`.

**What breaks if violated:** Shipping is taxed at the product rate (or vice versa), producing incorrect tax amounts for shipping line items.
