# Business Rule: Ship-From Address Resolution

## Overview

Stripe Tax supports origin-based tax calculation: the tax rate can depend on where an item ships FROM, not just where it ships TO. The ship-from address is resolved per line item using a three-level fallback strategy.

---

## Rule 1: Ship-from is resolved per line item, not per cart

**What:** Each line item may have a different ship-from address depending on its supply channel or inventory location. Line items are grouped by their resolved ship-from address, and a separate Stripe calculation request is created per group. Grouping is by four address fields (see Rule 8); how many requests each group produces depends on the shipping mode (`calculation-requests.md` Rules 1–2).

**Why:** A cart may contain items from multiple warehouses in different states or countries. Each origin has different tax obligations. Grouping by ship-from ensures accurate origin-based tax for each item.

**Invariant:** Always resolve ship-from per line item and group; never use a single cart-level ship-from address for all line items.

**Implementation:** `ship-from.service.js` → `resolveAllShipFromAddresses()`; `tax-orchestrator.service.js` → `groupLineItemsByShipFrom()`.

---

## Rule 2: Ship-from address is resolved with a three-level fallback

**What:** For each line item, `resolveShipFromForLineItem(lineItem)` tries these sources in order:

1. **Line item's supply channel** — uses `lineItem.supplyChannel.id` to fetch the channel, returns `channel.address` if set.
2. **Inventory supply channel** — queries inventory entries for `lineItem.variant.sku` (with `expand: 'supplyChannel'`), filters entries with both an address and `availableQuantity > 0`, picks one via `selectByPriority` (using `SHIP_FROM_CHANNEL_PRIORITY`) and falls back to highest-stock (Rule 7).
3. **Default business address** — built from `SHIP_FROM_DEFAULT_BUSINESS_COUNTRY/STATE/CITY/POSTAL_CODE/LINE1/LINE2`, returned only when `SHIP_FROM_REQUIRED='true'` (Rule 6).

When `SHIP_FROM_REQUIRED` is not `'true'` and steps 1–2 do not resolve an address, the service returns `{ address: null, source: 'not_required' }`, and the orchestrator places the line item into a single `'no_ship_from'` group.

**Why:** Not all products have supply channel data. The fallback chain ensures the best available address is used.

**Invariant:** The fallback order is strict: line item channel → inventory → default. The default tier activates only when `SHIP_FROM_REQUIRED='true'`. Never skip a higher-priority source when it is available.

**Implementation:** `ship-from.service.js` → `resolveShipFromForLineItem()`; the default address is built by `getDefaultBusinessAddress()`; `'no_ship_from'` bucketing happens in `tax-orchestrator.service.js` → `createAddressKey(null)`.

---

## Rule 3: `SHIP_FROM_REQUIRED` selects whether an unresolved item gets the default business address

**What:** When `SHIP_FROM_REQUIRED='true'`, a line item that neither its supply channel nor inventory places is given the default business address. When it is not set (or any other value), `'no_ship_from'` items are sent to Stripe without a `ship_from_details` field.

"Required" means the exact string `'true'`. `'TRUE'`, `'True'`, `'1'`, `'false'` and unset are all optional mode. `connect.yaml:35-37` defaults it to `'true'`.

**Why:** Some merchants require accurate origin-based tax and must not calculate without a ship-from address. Others deal with digital products or single-location businesses where ship-from is irrelevant.

**Invariant:** When `SHIP_FROM_REQUIRED='true'`, every product in the catalog must have a resolvable ship-from address. This is a configuration requirement analogous to tax codes.

**Implementation:** `tax-orchestrator.service.js` → `groupLineItemsByShipFrom()`.

---

## Rule 4: Ship-from resolution runs in parallel for all line items

**What:** `resolveAllShipFromAddresses()` resolves ship-from for all line items simultaneously using `Promise.all()`.

**Why:** Sequential resolution would add resolution time per line item to the total, pressing against the 2-second commercetools response budget (`tax-calculation.md` Rule 1) for carts with many line items.

**Invariant:** Always resolve ship-from addresses in parallel.

**Implementation:** `ship-from.service.js` → `resolveAllShipFromAddresses()` with `Promise.all()`.

---

## Rule 5: Line items without ship-from are sent to Stripe without `ship_from_details`

**What:** When a line item cannot be resolved to a ship-from address and `SHIP_FROM_REQUIRED` is not set, the item is included in the Stripe request without the `ship_from_details` field. Stripe uses destination-based tax for these items.

**Why:** For digital products, services, or merchants with a single location, ship-from is irrelevant. Omitting the field lets Stripe apply its default tax rules.

**Invariant:** Never send an empty or null `ship_from_details`. Either include a valid address object or omit the field entirely.

**Implementation:** `tax-orchestrator.service.js` — request construction includes `ship_from_details` only when an address is available.

---

## Rule 6: Default business address field fallbacks

**What:** In required mode, every line item without a channel or inventory address gets the default business address. Each field falls back to a hard-coded value when its variable is unset:
- `SHIP_FROM_DEFAULT_BUSINESS_COUNTRY` → `'US'`
- `..._STATE` → `'NY'`
- `..._CITY` → `'New York'`
- `..._POSTAL_CODE` → `'10001'`
- `..._LINE1` and `..._LINE2` → `''`

`connect.yaml:38-49` declares no default for any of them.

**Invariant:** `country: process.env.SHIP_FROM_DEFAULT_BUSINESS_COUNTRY || 'US'`, with the other fields following the same pattern.

**Implementation:** `ship-from.service.js` → `getDefaultBusinessAddress()`.

---

## Rule 7: Inventory-based ship-from prefers the configured channel order, then the most stock

**What:** Only inventory entries whose supply channel has an address **and** `availableQuantity > 0` are candidates. Among them:
- the first channel id listed in `SHIP_FROM_CHANNEL_PRIORITY` that is present wins;
- otherwise the entry with the highest `availableQuantity` wins, and on a tie the earlier entry is kept.

The priority list never overrides a line item's own `supplyChannel` (Rule 2, source 1).

**Invariant:** The candidate filter is `entry.supplyChannel?.obj?.address && entry.availableQuantity > 0`. Priority comes first, stock second; the comparison is strict `>`, so a tie keeps the earlier entry.

**Implementation:** `ship-from.service.js`.

---

## Rule 8: Line items are grouped by country, state, city and postal code only

**What:** Line items with the same `country`, `state`, `city` and `postal_code` share one ship-from group, and one set of provider requests. Two channels that differ only in street (`line1` / `line2`) merge into one group, which uses the first address seen. Every item with no ship-from address forms the single `'no_ship_from'` group.

**Invariant:**
- `createAddressKey` returns `'no_ship_from'` for a null address.
- Otherwise it returns a JSON key of the four fields.
- The group's address is set only when the key is first seen.

**Implementation:** `tax-orchestrator.service.js` → `createAddressKey()`, `groupLineItemsByShipFrom()`.
