# Business Rule: Ship-From Address Resolution

## Overview

Stripe Tax supports origin-based tax calculation: the tax rate can depend on where an item ships FROM, not just where it ships TO. The ship-from address is resolved per line item using a three-level fallback strategy.

---

## Rule 1: Ship-from is resolved per line item, not per cart

**What:** Each line item may have a different ship-from address depending on its supply channel or inventory location. Line items are grouped by their resolved ship-from address, and a separate Stripe calculation request is created per group.

**Why:** A cart may contain items from multiple warehouses in different states or countries. Each origin has different tax obligations. Grouping by ship-from ensures accurate origin-based tax for each item.

**Invariant:** Never use a single cart-level ship-from address for all line items. Always resolve per line item and group.

**Implementation:** `ship-from.service.js` → `resolveAllShipFromAddresses()`, `tax-orchestrator.service.js` → `groupLineItemsByShipFrom()`

**What breaks if violated:** Items from different origin locations are all taxed as if they shipped from one location, producing incorrect tax rates for items that should use a different origin.

---

## Rule 2: Ship-from address is resolved with a three-level fallback (default tier is gated by `SHIP_FROM_REQUIRED`)

**What:** For each line item, `resolveShipFromForLineItem(lineItem)` tries these sources in order:

1. **Line item's supply channel** — uses `lineItem.supplyChannel.id` to fetch the channel, returns `channel.address` if set. Source label: `lineItem.supplyChannel`.
2. **Inventory supply channel** — queries inventory entries for `lineItem.variant.sku` (with `expand: 'supplyChannel'`), filters entries with both an address and `availableQuantity > 0`, picks one via `selectByPriority` (using `SHIP_FROM_CHANNEL_PRIORITY`) and falls back to highest-stock. Source labels: `inventory.supplyChannel` (set as the only source string written to the group, with the selection reason logged separately).
3. **Default business address** — built from `SHIP_FROM_DEFAULT_BUSINESS_COUNTRY/STATE/CITY/POSTAL_CODE/LINE1/LINE2`. Returned **only when `SHIP_FROM_REQUIRED='true'`**. Source label: `default_business`.

When `SHIP_FROM_REQUIRED` is not `'true'` and steps 1-2 fail, the service returns `{ address: null, source: 'not_required' }`, and the orchestrator places the line item into a single `'no_ship_from'` group.

**Why:** Not all products have supply channel data. The fallback chain ensures the best available address is used without failing the calculation. The default tier is opt-in to avoid silently using a wrong origin for digital goods.

**Invariant:** The fallback order is strict: line item channel → inventory → default. The default tier only activates when `SHIP_FROM_REQUIRED='true'`. Never skip to a lower priority source if a higher one is available.

**Implementation:** `ship-from.service.js` → `resolveShipFromForLineItem()`. Fallback default address built by `getDefaultBusinessAddress()`. The `'no_ship_from'` bucketing happens in `tax-orchestrator.service.js` → `createAddressKey(null)`.

**What breaks if violated:** Using the default address when a more specific channel address exists produces less accurate origin-based tax rates. Returning the default when ship-from was meant to be optional taxes digital goods at an unrelated origin.

---

## Rule 3: SHIP_FROM_REQUIRED controls whether missing ship-from is a hard error

**What:** When `SHIP_FROM_REQUIRED='true'`, any line item that ends up in the `'no_ship_from'` group causes `ShipFromNotFoundError` to be thrown, failing the entire tax calculation. When not set (or any other value), `'no_ship_from'` items are sent to Stripe without a `ship_from_details` field.

**Why:** Some merchants require accurate origin-based tax and must not allow calculations without a ship-from address. Others deal with digital products or single-location businesses where ship-from is irrelevant.

**Invariant:** When `SHIP_FROM_REQUIRED='true'`, every product in the catalog must have a resolvable ship-from address. This is a configuration requirement analogous to tax codes.

**Implementation:** `tax-orchestrator.service.js` → `groupLineItemsByShipFrom()` — validation step after grouping.

**What breaks if violated:** With `SHIP_FROM_REQUIRED='true'` but some products lacking addresses, checkouts fail for those products. With required=false but ship-from actually needed for compliance, taxes are calculated without origin data and may be incorrect.

---

## Rule 4: Ship-from resolution runs in parallel for all line items

**What:** `resolveAllShipFromAddresses()` resolves ship-from for all line items simultaneously using `Promise.all()`.

**Why:** Sequential resolution would add N × resolution_time to the total execution time, pushing toward the 2-second CT timeout for carts with many line items.

**Invariant:** Always resolve ship-from addresses in parallel. Never resolve sequentially.

**Implementation:** `ship-from.service.js` → `resolveAllShipFromAddresses()` with `Promise.all()`.

**What breaks if violated:** For a 10-item cart, sequential resolution could add 500ms+ to execution time, causing CT extension timeout errors.

---

## Rule 5: Line items without ship-from are sent to Stripe without ship_from_details

**What:** When a line item cannot be resolved to a ship-from address and `SHIP_FROM_REQUIRED` is not set, the item is included in the Stripe request without the `ship_from_details` field. Stripe uses destination-based tax for these items.

**Why:** For digital products, services, or merchants with a single location, ship-from is irrelevant. Omitting the field lets Stripe apply its default tax rules.

**Invariant:** Never send an empty or null `ship_from_details`. Either include a valid address object or omit the field entirely.

**Implementation:** `tax-orchestrator.service.js` — request construction conditionally includes `ship_from_details` only when address is available.

**What breaks if violated:** Sending `ship_from_details: null` causes a Stripe API validation error, failing the tax calculation.
