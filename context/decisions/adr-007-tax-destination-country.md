# ADR-007: The delivery address is the only tax destination

**Status:** Accepted
**Date:** 2026-09-17

## Context

A commercetools cart carries two country fields, and they answer different questions:

| Field | Question it answers | Who controls it |
| --- | --- | --- |
| `cart.country` | Which catalog price applies? | The shopper — My Carts accepts `setCountry` from a customer or anonymous token |
| delivery address `country` | Where do the goods go? | The shopper, by choosing where to receive them |

The connector had been building the address it sends to Stripe Tax from both: street, city and
postal code from the delivery address, and country from `cart.country`. Stripe documents
`customer_details.address` as "the customer's location, or transaction destination", so that
country selected the tax jurisdiction — and Stripe "only calculates tax in jurisdictions where you
have an active tax registration. Without a registration in the customer's location, the
calculation returns zero tax."

A shopper could therefore set their own cart country to any other market the merchant sells in,
leave the delivery address untouched, and receive an authoritative zero-tax or wrong-tax total.
In `ExternalAmount` tax mode that total is what the cart becomes payable at, and the retained
calculation reference is what `order-syncer` later turns into the compliance transaction.

Reported externally as CTT-002, CWE-840, CVSS 6.5 Medium. Tracked as SB3-218.

The same confusion had a second exit. `tax-behavior.service.js` resolved inclusive/exclusive from
the same `cart.country`, so where a merchant mapped two markets to different behaviors, a shopper
could force `inclusive` on a price published as exclusive. Stripe's behavior there is explicit:
with inclusive, "the amount your customer pays remains constant, regardless of the tax amount" —
so the shopper pays the list price and the merchant remits the tax out of their own margin.

And a third consequence needed no attacker at all: in Multiple shipping mode every destination
received `cart.country`, so a cart legitimately delivering to two countries was taxed as if both
went to one.

## Decision

**The tax destination is the delivery address, entirely. `cart.country` selects prices and never
determines tax.**

Three rules follow:

1. **`customer_details.address` is built only from the delivery address**, country included, in
   both shipping modes. In Multiple mode each shipping method contributes its own.
2. **`tax_behavior` resolves from the destination country**, not from `cart.country`. With no
   destination there is no destination rule, and resolution falls through to the merchant default
   and then to the account's own Stripe Tax setting.
3. **A delivery address that exists must be complete.** One naming a city, postal code or street
   without a country is refused (`InvalidTaxDestinationError` → commercetools `InvalidInput`)
   rather than completed from `cart.country`.

`cart.country` survives in exactly one place: as the country of an otherwise empty address, for a
cart that has not collected a delivery address yet. That keeps carts calculating before the
shopper enters one, and cannot be reached to complete a partial address because rule 3 rejects
those first.

## Alternatives Considered

| Alternative | Why discarded |
| --- | --- |
| Use the destination for the address but keep `tax_behavior` on `cart.country` | This was the first draft, on the reasoning that behavior belongs to how the *price* was published. It leaves the second vector open: where the two markets map to different behaviors and prices are equal, the shopper still picks the behavior. |
| Keep `cart.country` for behavior, plus a coherence guard forcing `exclusive` when the two countries disagree | Workable, but it invents a rule on top of Stripe's. Reading their guidance made it unnecessary — see below. |
| Reject any cart where `cart.country` differs from the delivery country | commercetools explicitly allows the divergence and it is an ordinary cross-border purchase — a shopper in Spain shipping a gift to France. Rejecting it breaks real merchants to close an attack that rule 1 already closes. |
| Derive `tax_behavior` from the cart currency directly | Stripe's recommended "Automatic" setting already does exactly this — exclusive for USD and CAD, inclusive otherwise. Reimplementing it in the connector duplicates a decision the merchant already makes in their Stripe account, and would silently diverge if Stripe changed it. Delegating is better than copying. |

## Consequences

**Positive:** Nothing a shopper can reach selects the tax jurisdiction or the tax behavior any
more. The commercetools cart has no update action that changes its currency, so the fallback
path — the account's Automatic, currency-based setting — is not reachable either. A Multiple-mode
cart is now taxed correctly per destination, which it never was.

**Negative:** `TAX_BEHAVIOR_COUNTRY_MAPPING` changes meaning. It is now keyed on where an order is
delivered, not on which market it was priced for. A merchant who configured it reading it the
other way will see different behavior after upgrading. This is documented in the CHANGELOG.

**Risks:** The rule holds only while there is one definition of "the destination". Both the
address sent to Stripe and the country used for tax behavior read through
`extractCustomerAddress()` for that reason. A future change that resolves the destination
independently somewhere else reopens this defect without touching any of the code the regression
tests cover.

## Verification

Reproduced and verified against live Stripe Tax in test mode on 2026-09-17, same cart throughout,
`cart.country = "US"`:

| Delivery | Country reaching Stripe | Behavior | Tax |
| --- | --- | --- | --- |
| United States (registered) | `US` | exclusive | 29,791 exclusive |
| Berlin (registered) | `DE` | inclusive | 57,782 inclusive — 19% German VAT |
| Madrid (not registered) | `ES` | inclusive | 0 |

The Madrid row is the reported mechanism itself, seen directly: a destination with no active
registration returns zero tax. That is what the attack manufactured by sending a false country.

Regression suite: `tax-calculator/test/unit/services/tax-destination-country.spec.js`.

## Implementation

| Concern | Where |
| --- | --- |
| Destination address | `tax-orchestrator.service.js` → `extractCustomerAddress()` |
| Single definition of the destination | `tax-orchestrator.service.js` → `resolveDestinationCountry()` |
| Incomplete-address guard | `tax-orchestrator.service.js` → `assertDestinationIsUsable()`, `errors/invalidTaxDestination.error.js` |
| Behavior from destination | `tax-behavior.service.js` → `determineTaxBehaviorForCart(cart, destinationCountry)` |
| Destination recorded on the cart | `update-action.service.js` → `summariseDestinations()`, custom field `connectorStripeTax_destinationCountry` |
| Stale calculations not replayed | `tax-orchestrator.service.js` → `reapplyExistingCalculation()` |

## Reaching carts that already exist

A calculation now records the destination it was made for, and is only re-applied while that still
matches where the order is going. One stored before this decision records no destination, so it is
never replayed — it is recalculated on the cart's next extension trigger.

This was chosen over sweeping every cart at post-deploy: a sweep mutates a merchant's entire cart
collection, can fail halfway, and has to be re-run correctly forever. Recording the destination is
self-healing and needs no migration.

It closes the country dimension of a related defect: re-apply does not otherwise revalidate that a
stored calculation still matches the cart. A change of city, postal code or street within the same
country still replays. That remains open and is tracked separately.
