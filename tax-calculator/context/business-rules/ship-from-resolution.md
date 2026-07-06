# Ship-From Resolution

How the service determines the ship-from (origin) address used for each Stripe Tax calculation, and what happens when resolution fails.

## Rule 1: Ship-from follows a channel → inventory → default fallback chain

**What:** For each shipment, the ship-from address is resolved by trying the supply channel first, then inventory, then falling back to the `SHIP_FROM_DEFAULT_BUSINESS_*` configured address. `SHIP_FROM_CHANNEL_PRIORITY` (default `[]`) orders which channels are considered.
**Why:** Tax origin can vary per warehouse/channel; the chain lets a merchant express origin at the channel or inventory level while still guaranteeing a usable default.
**Invariant:** Every shipment resolves to some ship-from address — a channel address, an inventory address, or the default business address (defaults to New York, US, `10001`).
**Implementation:** channel lookup `src/services/ship-from.service.js:96`; inventory lookup `:125`; channel priority `:216`; defaults `:231-236`.
**Closure criterion:** `grep -n "SHIP_FROM_DEFAULT_BUSINESS" src/services/ship-from.service.js` shows the default chain terminus.
**What breaks if violated:** A shipment with no resolvable origin would have no ship-from, and Stripe would compute tax against an incorrect or absent origin jurisdiction.

---

## Rule 2: Channel and inventory lookup failures degrade silently to null

**What:** If the CT channel or inventory API call fails, the lookup catches the error, logs a warning, and returns null — which flows into the default fallback. A transient failure is therefore indistinguishable from "no ship-from configured".
**Why (as-implemented):** The code favors always returning a tax result over failing the request; this trades correctness for availability.
**Invariant:** A ship-from lookup never throws on CT API failure; it returns null and the default is used instead.
**Implementation:** `src/services/ship-from.service.js:111-114,161-164`.
**Closure criterion:** `grep -n "return null" src/services/ship-from.service.js` shows the swallow points inside the channel/inventory try/catch blocks.
**What breaks if violated:** A transient CT outage silently changes the tax origin to the default address, producing a different (wrong) tax amount with no error surfaced (see `context/known-issues.md` Issue 5).

---

## Rule 3: SHIP_FROM_REQUIRED controls tolerance of a missing ship-from

**What:** `SHIP_FROM_REQUIRED` (default falsey) governs whether a missing ship-from is tolerated (fall back to default) or treated as a hard requirement during orchestration.
**Why:** Some deployments must guarantee a real per-shipment origin (e.g., multi-warehouse tax nexus) and cannot accept the default address silently.
**Invariant:** When `SHIP_FROM_REQUIRED` is set truthy, the orchestrator enforces presence of a resolved ship-from; when falsey (default), the default address is accepted.
**Implementation:** `src/services/ship-from.service.js:57,71`; enforced in orchestration at `src/services/tax-orchestrator.service.js:193`.
**Closure criterion:** `grep -n "SHIP_FROM_REQUIRED" src/services/ship-from.service.js src/services/tax-orchestrator.service.js`.
**What breaks if violated:** With the flag unset (default), a deployment that actually requires a real origin will silently ship-from New York, US — under/over-taxing shipments from other warehouses.
