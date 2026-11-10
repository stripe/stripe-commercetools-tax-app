# Calculation Requests

How a cart is turned into tax-provider calculation requests: how many are sent, what each one
contains, and what is left out. The mode is the cart's `shippingMode`.

## Rule 1: Single mode sends one calculation per ship-from group

**What:** When `cart.shippingMode === 'Single'`, each ship-from group (`ship-from.md` Rule 8, *Line items are grouped by country, state, city and postal code only*)
produces exactly one request, containing every line item in the group.
**Why:** A Single-mode cart has one delivery address and one shipping method.
**Invariant:** `if (cart.shippingMode === 'Single') return [await this.createSingleRequestForGroup(...)]`
(`tax-calculator/src/services/tax-orchestrator.service.js:214-215`), called once per group (`:143-145`).
**Implementation:** `tax-calculator/src/services/tax-orchestrator.service.js:212-221`

---

## Rule 2: Every non-`'Single'` cart is built as Multiple mode — one request per ship-from group × shipping entry

**What:** Any `shippingMode` other than the exact string `'Single'` takes the Multiple path. Each
group produces one request per entry in `cart.shipping`. A request is dropped when it has neither
line items nor a shipping cost.
**Why:** Each shipping method in Multiple mode can go to a different address and carry its own
price.
**Invariant:**
- The loop is `for (const shipping of cart.shipping)` (`tax-calculator/src/services/tax-orchestrator.service.js:309`).
- A request is kept only `if (request.line_items.length > 0 || request.shipping_cost)` (`:326`).

**Implementation:** `tax-calculator/src/services/tax-orchestrator.service.js:303-337`

---

## Rule 3: In Multiple mode a line item is sent only for the shipping keys it targets, split by quantity

**What:** For each shipping entry, a line item is included only if
`lineItem.shippingDetails.targets` has an entry with that `shippingMethodKey` and a non-zero
quantity. Its amount is the line total multiplied by `target.quantity / quantity`, rounded.
Slices whose amount is 0 are dropped.

**Why:** Each slice of a split line item is taxed at its own destination.
**Invariant:**
- `if (!target || target.quantity === 0) return null` (`tax-calculator/src/services/tax-orchestrator.service.js:444-445`).
- `Math.round((totalAmount * target.quantity) / totalQuantity)` (`:450`).
- Pushed only `if (lineItemData && lineItemData.amount > 0)` (`:408`).

**Implementation:** `tax-calculator/src/services/tax-orchestrator.service.js:397-472`

---

## Rule 4: In Single mode every line item is sent, including zero-amount ones

**What:** Single mode puts each line item in its group's request with
`amount: lineItem.totalPrice?.centAmount`. There is no `> 0` filter, unlike Multiple mode.
**Invariant:** the loop `for (const lineItem of group.lineItems)` pushes unconditionally
(`tax-calculator/src/services/tax-orchestrator.service.js:271`), with
`amount: lineItem.totalPrice?.centAmount` (`:253`).
**Implementation:** `tax-calculator/src/services/tax-orchestrator.service.js:251-272`

---

## Rule 5: A shipping cost is sent only when its price is non-zero

**What:** A shipping cost goes into a request only when its price `centAmount` is truthy, so a
zero-price shipping method is never sent.
**Invariant:** the guard is `if (!...price?.centAmount) return null`
(`tax-calculator/src/services/tax-orchestrator.service.js:482`, `:500`).

---

## Rule 6: Every request is a fresh, single-attempt calculation with no idempotency key

**What:**
- All requests are sent in parallel, each one `tax.calculations.create` with no idempotency key
  and no retry.
- Every fresh orchestration creates new calculations, whether or not an identical one already
  exists.
- The internal `shippingKey` property is removed before sending.

**Why:** A calculation is a quote, not a committed document, so a duplicate is not a financial
duplicate.
**Invariant:** `return stripeClient.tax.calculations.create(stripeRequest)`
(`tax-calculator/src/services/tax-orchestrator.service.js:652`) is called with one argument, and
`delete stripeRequest.shippingKey` precedes it (`:650`).
**Implementation:** `tax-calculator/src/services/tax-orchestrator.service.js:641-654`
