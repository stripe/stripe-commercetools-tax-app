# Business Rule: Tax Code Resolution

## Overview

Every line item sent to Stripe Tax must have a tax code (`txcd_XXXXXXXX`). Tax codes determine how Stripe classifies the product for tax purposes. The connector resolves a line item's tax code by scanning the CT product categories the product is directly assigned to.

---

## Rule 1: Tax code is required — missing code fails the cart update

**What:** If `taxCodeService.getTaxCodeForProduct()` cannot find a tax code for a line item, it throws `TaxCodeNotFoundError`, which propagates up and fails the tax calculation for that cart update. The throw happens synchronously while the request is being built, so no request is sent for any line item, and the cart update is refused with HTTP 400 `InvalidInput` (`error-responses.md` Rule 1, *Unclassifiable input refuses the cart update with 400 `InvalidInput`*). The category lookup uses the published product projection (`staged: false`).

**Why:** Stripe Tax cannot calculate tax without knowing what type of product is being sold.

**Invariant:** Every product in a taxable cart must have a resolvable tax code. This is a configuration requirement, not a runtime fallback. Merchants must configure tax codes on their CT categories.

**Implementation:** `tax-code.service.js` → `getTaxCodeForProduct()` throws if no code is found; mapped to HTTP 400 in `tax-error-handler.service.js`.

---

## Rule 2: Tax code is resolved by scanning each direct category's custom field — first match wins

**What:** For a given line item, the service iterates over the categories directly assigned to the product and returns the first category whose custom field `connectorStripeTax_TaxCode` is set; "set" means a truthy value. Resolution inspects only those directly assigned categories, via `getCustomTypeCategoryTaxCode()`.

**Why:** Merchants assign products to leaf or near-leaf categories, and the first-found scan keeps resolution deterministic.

**Invariant:** The custom-type field name is always `connectorStripeTax_TaxCode` (the constant `TAX_CODE_CUSTOM_TYPE_NAME`). The order of the product projection's `categories` array — passed in as `categoriesMap.get(lineItem.productId)` — determines tie-breaking; the first non-empty value wins.

**Implementation:** `getTaxCodeForProduct()` calls `getCustomTypeCategoryTaxCode(categories)`; if it returns `null`, the service throws `TaxCodeNotFoundError`. `categoryService.getCategoriesForProducts()` retrieves the categories with `expand: ['categories[*]']` via Product Projections (`tax-calculator/src/services/category.service.js:135-137`).

---

## Rule 3: Category data is cached for 5 minutes

**What:** `categoryService.getCategoriesForProducts()` fetches the required categories and caches the result for 300 seconds. Subsequent calls within the cache window return the cached data. The cache holds one entry per `(staged, locale)`. Catalogs of more than 500 products are fetched in batches of 500, up to five in flight at once; on a partial cache hit only the missing products are fetched. The same 5-minute, per-instance, in-memory TTL also applies to shipping methods, supply channels and the tax-behavior configuration.

**Why:** Category data changes rarely; fetching it on every cart update would consume CT API rate limits and add latency toward the 2-second CT timeout.

**Invariant:** The cache TTL is 5 minutes and should not be disabled under normal operation. When a merchant updates a category's tax code, the change takes up to 5 minutes to propagate to tax calculations.

**Implementation:** `category.service.js` — in-memory cache with a 5-minute TTL (`this.cacheTTL = 5 * 60 * 1000` at `tax-calculator/src/services/category.service.js:24`).

---

## Rule 4: Shipping tax code comes from the shipping method, not from line item categories

**What:** The tax code for shipping costs is read from the shipping method's custom field `connectorStripeTax_TaxCode`, not from any product category. The shipping method is fetched via `apiRoot.shippingMethods().withId(...)` (cached for 5 minutes per `shippingMethodId`). If no code is configured on the shipping method, `getShippingTaxCodeFromShippingInfo()` returns `null` and `tax_code` is sent as `null`; no error is raised. When the shipping price is zero or falsy, no shipping cost is sent and no tax code is looked up. A failed shipping-method fetch is answered with the platform SDK's own status (`error-responses.md` Rule 3, *Any other error carrying a `statusCode` is answered with that status*).

**Why:** Shipping is not a product — it has its own tax classification separate from the items being shipped. In many jurisdictions, shipping is taxed differently from goods.

**Invariant:** Never use a product tax code for shipping. Never use a shipping tax code for products. They are resolved from different sources but use the same field name (`connectorStripeTax_TaxCode`) on different resource types.

**Implementation:** `tax-code.service.js` → `getShippingTaxCodeFromShippingInfo(shippingInfo)` → `getShippingMethodById(id)` (cached) → reads `shippingMethod.custom.fields.connectorStripeTax_TaxCode` (`tax-calculator/src/services/tax-code.service.js:262-272`, `:279-312`).
