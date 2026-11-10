# Calculation Results

How provider calculations become the cart update actions that `tax-calculator` returns: what
amounts and rates are written, and what is written for shipping. The action order, the zero-tax
back-fill, partial failure and the stored references are in `tax-calculation.md` Rules 3–5
(*Update action ordering is mandatory*; *Parallel calculations with graceful partial failure*;
*Calculation references must be written via setCustomType in the same response*).

## Rule 1: A line item's net total is the provider's line `amount`, and its gross comes from the provider's calculation

**What:** `setLineItemTotalPrice.totalPrice` is set to the provider's line `amount` (the base amount
without taxes), and `setLineItemTaxAmount.totalGross` to the provider's taxed total for that line.
**Why:** The code comment states the intent: *"Set totalPrice to base amount (without taxes)"*.
**Invariant:**
- `const totalPriceBase = lineItemData.amount` (`tax-calculator/src/services/update-action.service.js:581`).

**Implementation:** `tax-calculator/src/services/update-action.service.js:578-608`, `:681-746`

---

## Rule 2: The cart's gross total is the sum of the successful calculations' `amount_total`, written only when positive

**What:** `setCartTotalTax.externalTotalGross.centAmount` is the sum of `amount_total` across the
calculations that succeeded. When that sum is falsy or `<= 0`, no `setCartTotalTax` is emitted.
**Why:** The comment marks this action as required for `ExternalAmount` tax mode.
**Invariant:**
- `accumulator.amountTotal += calc.amount_total || 0` (`tax-calculator/src/services/update-action.service.js:145`).
- `if (!calculation.amount_total || calculation.amount_total <= 0) return null` (`:270-272`).
- `centAmount: calculation.amount_total` (`:279`).

**Implementation:** `tax-calculator/src/services/update-action.service.js:143-165`, `:269-282`

---

## Rule 3: A line item's tax rate is the breakdown whose rate reproduces its tax within one cent, otherwise the most common tax type

**What:** The provider does not say which breakdown belongs to which line item, so the connector
infers it:
1. it takes the first breakdown where `Math.round(amount × rate)` is within 1 cent of the line's
   `amount_tax`;
2. failing that, it takes the first breakdown of the **most common** `tax_type` in the calculation.

The line's gross amount always comes from the provider (Rule 1).
**Why:** The code comment: *"It is not explicitly labeled what breakdown corresponds to what line
item"*.
**Invariant:**
- `Math.abs(expectedTax - actualTax) <= 1` (`tax-calculator/src/services/update-action.service.js:802`).
- Otherwise `findBreakdownByMostCommonTaxType` (`:769`).
- Breakdowns without `percentage_decimal` are discarded before matching (`:787`).

**Implementation:** `tax-calculator/src/services/update-action.service.js:754-838`

---

## Rule 4: Single-mode shipping tax is one unkeyed action — possibly zero

**What:** When no Multiple-mode shipping groups were tracked, one `setShippingMethodTaxAmount`
without `shippingKey` is built from the combined calculation.

| Condition | Result |
| --- | --- |
| no shipping cost, or shipping tax `<= 0` | zero-tax action, with gross = combined shipping amount (`0` when the cart had no shipping charge) |
| a breakdown matches | gross = `shippingAmount + shippingTaxAmount` |

**Invariant:**
- The Single-mode path is chosen by `else` on `shippingInfoGroups.length > 0`
  (`tax-calculator/src/services/update-action.service.js:48`, `:52`).
- `if (!calculation.shipping_cost || shippingTaxAmount <= 0)` returns the zero action (`:1241`).

**Implementation:** `tax-calculator/src/services/update-action.service.js:1237-1301`

---

## Rule 5: Multiple-mode shipping tax is one action per cart shipping key, matched to calculations by position

**What:** One `setShippingMethodTaxAmount` is emitted for **every** `cart.shipping[].shippingKey`.
- **No calculation for a key** → a zero-tax action carrying the cart's price for that key.
- **Calculation-to-key matching** pairs calculations with requests by position.
- **Several calculations for one key** (one per ship-from group) → their shipping amounts and tax
  are summed.

**Invariant:**
- The keys come from `cart.shipping.map(s => s.shippingKey)` (`tax-calculator/src/services/update-action.service.js:1136`).
- `if (!mappedData?.calculation)` → zero-tax (`:1161-1164`).
- The positional loop is `for (let i = 0; i < Math.min(calculations.length, requests.length); i++)` (`:1013`).
- The sum is in `processShippingCost` (`:872-877`).

**Implementation:** `tax-calculator/src/services/update-action.service.js:1112-1211`, `:1012-1031`

---

## Rule 6: In Multiple mode every line-item action carries the shipping key of its calculation

**What:** A calculation is mapped to a shipping key through the `metadata.shippingKey` of its
first line item. Every `setLineItemTotalPrice` and `setLineItemTaxAmount` built from it carries
that key.
**Branches:**
- **A calculation with no line items** (shipping only) is not mapped this way. The positional
  fallback runs only when **no** calculation mapped at all.
- **Single mode** sends `metadata.shippingKey: cart.shippingKey`
  (`tax-calculator/src/services/tax-orchestrator.service.js:258`). If that value is truthy, Single
  mode also emits keyed actions.

**Why:** The comment records the platform constraint: *"Multiple mode - REQUIRED by Commercetools"*.
A keyed line item without its key, in Multiple mode, is rejected by the platform.
**Invariant:**
- `if (lineItems.length > 0 && lineItems[0].metadata?.shippingKey)` (`tax-calculator/src/services/update-action.service.js:299`).
- The fallback runs only `if (calculationToShippingKey.size === 0 && shippingInfoGroups.length > 0)` (`:305`).
- The key is attached `if (shippingKey)` (`:603-604`, `:738-739`).

**Implementation:** `tax-calculator/src/services/update-action.service.js:292-315`
