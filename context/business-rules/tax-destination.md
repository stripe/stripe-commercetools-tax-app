# Tax Destination

Which address `tax-calculator` tells the tax provider the order is going to, and when it refuses
to compute tax at all because that address is unusable.

## Rule 1: The destination comes from the delivery address, chosen by shipping mode

**What:** The address sent as `customer_details.address` depends on `cart.shippingMode`:
- `=== 'Single'` → `cart.shippingAddress`.
- `=== 'Multiple'` → the address of the shipping entry being priced. If that entry has none, the
  first entry's address (`cart.shipping[0]`) is used.
- Any other value, `undefined` included → no address at all (`{}`).

**Why:** `cart.country` is a price-selection field the shopper controls, not a statement of where
goods are delivered.
**Invariant:** The three branches of `extractCustomerAddress` select the address: the Single
branch at `tax-calculator/src/services/tax-orchestrator.service.js:534`, the per-shipping Multiple
branch at `:538`, and the first-shipping fallback at `:541`. An unrecognised `shippingMode` takes
neither branch and leaves the address `{}` (`:530`).
**Implementation:** `tax-calculator/src/services/tax-orchestrator.service.js:529-559`

---

## Rule 2: `cart.country` is the destination only when no delivery address exists at all

**What:** `cart.country` is used only when the address chosen by Rule 1 has a falsy `country`
**and** none of `city`, `postalCode`, `streetName`, `state`, `line1`. That covers a cart with no
address yet, and any cart whose `shippingMode` is neither `Single` nor `Multiple`.
**Why:** A cart must still calculate before the shopper has entered an address.
**Invariant:** `country: shippingAddress.country || cart.country`
(`tax-calculator/src/services/tax-orchestrator.service.js:552`). The fallback can only be reached
after `assertDestinationIsUsable` (`:546`) has returned without throwing (Rule 3).
**Implementation:** `tax-calculator/src/services/tax-orchestrator.service.js:546-552`

---

## Rule 3: A delivery address that locates the order but names no country rejects the cart

**What:** If the chosen address has a falsy `country` but a truthy `city`, `postalCode`,
`streetName`, `state` or `line1`, the cart update is refused with HTTP 400 before any provider call.
**Invariant:**
- `shippingAddress?.country` truthy → accepted (`tax-calculator/src/services/tax-orchestrator.service.js:608`).
- Otherwise `['city','postalCode','streetName','state','line1'].some(field => shippingAddress?.[field])`
  (`:612-613`) true → `throw new InvalidTaxDestinationError` (`:616`).
- Otherwise → no throw; Rule 2 applies.

The test is **truthiness**: an empty-string `city` does not count as locating the order.
**Implementation:** `tax-calculator/src/services/tax-orchestrator.service.js:607-618`;
mapped to 400 at `tax-calculator/src/services/tax-error-handler.service.js:30-31`, `:76-84`

---

## Rule 4: Tax behavior is resolved from the same destination the provider is told

**What:** The country that selects the tax behavior is read through the same function that builds
`customer_details.address`, so the two cannot differ.
**Invariant:** `resolveDestinationCountry` returns `this.extractCustomerAddress(cart, shipping).country`
(`tax-calculator/src/services/tax-orchestrator.service.js:572-573`). It is called once per cart at
`:42`, once per ship-from group at `:305` and once per shipping entry at `:314` in Multiple mode.
On the re-apply path the destination is no longer derived here: `reapplyExistingCalculation()` reads it
from the retrieved calculation's own `customer_details.address` and compares it with
`extractCustomerAddress(cart)` through `createAddressKey()` (see `tax-calculation.md` Rule 2).
**Implementation:** `tax-calculator/src/services/tax-orchestrator.service.js:572-574`
