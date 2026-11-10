# Tax Behavior

Whether amounts sent to the tax provider are declared tax-inclusive or tax-exclusive, and what
happens when nothing decides it. That shipping takes the same behavior as the line items in its
request is `tax-calculation.md` Rule 6, *Shipping tax behavior follows the same resolved behavior as line items*.

## Rule 1: The country mapping applies only when the destination exists and matches an upper-case key

**What:** `TAX_BEHAVIOR_COUNTRY_MAPPING` is consulted with the destination country upper-cased.
**Branches:**
- No destination → the mapping is skipped.
- The mapping value is not `inclusive` / `exclusive` (case-insensitive) → the mapping is skipped.
- A mapping that is not valid JSON is logged at warn level and treated as empty.

**Why:** The mapping is the merchant's per-country statement of how prices are expressed. It is
keyed on the delivery destination, never on `cart.country` (`tax-destination.md` Rule 4, *Tax behavior is resolved from the same destination the provider is told*).
**Invariant:**
- `if (!countryCode) return null` (`tax-calculator/src/services/tax-behavior.service.js:82-83`).
- Otherwise `countryMapping[countryCode.toUpperCase()]` (`:88`) is used only when
  `behavior && this.isValidBehavior(behavior)` (`:90`), and returned lower-cased (`:91`).
- A parse failure falls through to `return {}` (`:138-142`).

**Implementation:** `tax-calculator/src/services/tax-behavior.service.js:81-98`, `:122-143`

---

## Rule 2: `TAX_BEHAVIOR_DEFAULT` applies only when the country mapping gives nothing

**What:** The merchant default is the second priority. If it is unset, or not a valid behavior,
there is no fallback in code.
**Why:** It lets a merchant set one behavior for every country not mapped explicitly.
**Invariant:** `determineCartTaxBehavior` returns the country behavior if truthy
(`tax-calculator/src/services/tax-behavior.service.js:52-54`). Otherwise it returns
`getMerchantDefaultBehavior()` if truthy (`:58-61`), otherwise `null` (`:66`). The merchant
default is used only when `merchantBehavior && this.isValidBehavior(merchantBehavior)` (`:108`).
**Implementation:** `tax-calculator/src/services/tax-behavior.service.js:49-67`

> **Mode:** `connect.yaml:26-28` declares a default of `'exclusive'`, so a deployed connector
> normally has a merchant default. The code itself has none: run outside Connect with the variable
> unset, the result is `null` (Rule 3).

---

## Rule 3: When no behavior is resolved, no `tax_behavior` is sent and the provider's account default applies

**What:** A `null` behavior omits the key from every line item, and from the shipping cost. It is
never filled in with a constant.
**Why:** It defers to the provider-side setting, so the connector does not impose one. Stripe's
recommended "Automatic" setting is already currency-based, and reimplementing it here would
duplicate a decision the merchant makes in their Stripe account.
**Invariant:** `tax_behavior` is assigned only inside `if (lineItemBehavior)`:
- Single mode: `tax-calculator/src/services/tax-orchestrator.service.js:267-268`.
- Multiple mode: `:467-468`.
- Shipping: inside `if (shippingBehavior)`, at `:286-287` and `:423-424`.

**Implementation:** `tax-calculator/src/services/tax-orchestrator.service.js:267`, `:286`, `:423`, `:467`

---

## Rule 4: One behavior per cart and destination, applied to every line item

**What:**
- Every line item receives the same behavior.
- In Single mode it is resolved once per cart.
- In Multiple mode it is resolved again for each shipping entry whose destination differs from the
  cart-level destination.

**Why:** A cart is expressed in one price convention per destination.
**Invariant:** `lineItemBehaviors[lineItem.id] = cartTaxBehavior` for every line item
(`tax-calculator/src/services/tax-behavior.service.js:35`). Multiple mode re-resolves only when
`destination !== cartDestination` (`tax-calculator/src/services/tax-orchestrator.service.js:315-318`).
**Implementation:** `tax-calculator/src/services/tax-behavior.service.js:28-39`;
`tax-calculator/src/services/tax-orchestrator.service.js:306`, `:315-318`
