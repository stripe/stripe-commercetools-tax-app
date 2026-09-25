# Business Rule: Tax Calculation

## Overview

The tax-calculator runs as a CT API Extension — a synchronous callback that CT invokes before persisting a cart update. The response must be returned within the timeout window and must follow the exact CT update action format.

---

## Rule 1: The extension must respond within 2 seconds

**What:** CT's API Extension has a hard timeout of 2000ms. If the tax-calculator doesn't respond in time, CT treats it as a failure and the cart update is rejected.

**Why:** CT API Extensions are synchronous — they block the cart update. A slow response blocks the customer's checkout. The 2-second limit is enforced by CT, not the connector.

**Invariant:** The total execution time — category fetch + ship-from resolution + all Stripe calculations — must stay under 2 seconds. Parallel execution of Stripe calculations is non-negotiable; sequential execution would exceed the timeout for multi-item carts.

**Implementation:** `tax-orchestrator.service.js` — parallel execution via `Promise.allSettled()`, category cache with 5-min TTL to avoid repeated CT API calls.

**What breaks if violated:** CT rejects the cart update with an extension timeout error. The customer sees a checkout error. The cart is not updated with tax amounts.

---

## Rule 2: Extension trigger filters on tax mode, line items, change set, and payment state

**What:** The API Extension trigger condition (registered by `tax-calculator/src/connectors/action.js:31` → `createCTPExtension`) is, **as of 2026-06-03** (commit `d518598`, "restore tax on carts with payment already attached" — this rule was stale before that date, corrected 2026-07-27):

```text
taxMode="ExternalAmount"
  AND lineItems is defined AND lineItems is not empty
  AND (shippingInfo is defined OR lineItems(shippingDetails is defined))
  AND (
        paymentInfo is not defined
        OR (taxedPrice is not defined AND custom(fields(connectorStripeTax_calculationReferences is defined)))
        OR (shippingMode="Single" AND shippingInfo is defined AND shippingInfo(taxedPrice is not defined)
            AND custom(fields(connectorStripeTax_calculationReferences is defined)))
      )
  AND (taxMode has changed OR lineItems has changed OR shippingInfo has changed
       OR shippingAddress has changed OR shipping has changed
       OR itemShippingAddresses has changed)
```

The extension only fires when ALL clauses are true. `cartState=Frozen` is **not** part of the condition.

**Why:** `taxMode=ExternalAmount` ensures the connector only runs when CT delegates tax to it. Requiring line items + shipping info means the cart actually has something to tax. The payment-state clause is no longer a simple exclusion — see the re-apply exception below. The "has changed" group prevents redundant calls when nothing tax-relevant changed.

**The payment-state clause has two cases:**

1. **Base case — `paymentInfo is not defined`:** the ordinary rule. Once a payment is attached to the cart, the extension stops firing — this still holds for the overwhelming majority of carts and is the correct mental model for "does this cart still get tax recalculated?"
2. **Re-apply exception (added 2026-06-03):** commercetools clears `taxedPrice` (or `shippingInfo.taxedPrice` in Single shipping mode) after certain cart mutations — e.g. `setShippingAddress` — **even when `paymentInfo` is already set**, which would otherwise leave the cart permanently untaxed. The widened condition lets the extension fire in this narrow case, **but only when a Stripe Tax calculation reference already exists** (`connectorStripeTax_calculationReferences` populated). `tax.calculator.controller.js`'s `isReapplyScenario()` detects this and re-applies the *existing* calculation (retrieved by ID) rather than creating a new one — this avoids breaking the already-created PaymentIntent's tax reference and keeps the PI, cart, and `order-syncer` on the same `calculationId`. A cart with payment attached and **no** existing calculation reference is still blocked, exactly as before.

   **Destination guard (added 2026-09-17, SB3-218):** re-applying trusts a stored calculation without asking Stripe again, so it is only safe while that calculation still belongs to where the order is going. `reapplyExistingCalculation()` compares the destination recorded with the calculation (`connectorStripeTax_destinationCountry`) against the cart's current delivery destination, and **falls back to a full recalculation** when they differ or when none was recorded. Note the trigger that reaches this path is often `setShippingAddress` itself — the very mutation that can change the destination — so the guard is not hypothetical. A calculation stored before 2026-09-17 records no destination and is therefore always recalculated: that is how the fix reaches carts that already existed, with no migration. See `../decisions/adr-007-tax-destination-country.md`.

   **Still open:** the guard compares the country only. A change of city, postal code or street *within the same country* still replays the stored calculation. Tracked separately.

**Invariant:** If a cart with no payment attached is not triggering tax calculation, verify: `taxMode`, line items present, shipping/shippingDetails present, and that the relevant field actually changed. If a cart **with payment attached** unexpectedly triggers (or fails to trigger) recalculation, check whether it matches the re-apply exception — specifically whether `connectorStripeTax_calculationReferences` is already populated and whether `taxedPrice` was cleared by the preceding mutation.

**Implementation:** `tax-calculator/src/connectors/action.js:31` → `createCTPExtension()` (the JSON is built inline, not loaded from a separate `resources/api-extension.json`); `tax-calculator/src/controllers/tax.calculator.controller.js` → `isReapplyScenario()`; `tax-calculator/src/services/tax-orchestrator.service.js` → `reapplyExistingCalculation()` and `summariseCartDestinations()` for the destination guard.

**What breaks if violated:** Loosening the predicate further (e.g., removing the change-detection clause, or dropping the `connectorStripeTax_calculationReferences` guard from the re-apply exception) causes redundant Stripe Tax calls during browse and after payment, or lets a cart with payment attached and no prior calculation trigger a brand-new Stripe Tax calculation that could break the existing PaymentIntent's tax reference. Tightening it (e.g., re-adding `cartState=Frozen`, or reverting to the pre-2026-06-03 simple exclusion) prevents legitimate updates from being taxed — the exact regression this rule was introduced to fix.

---

## Rule 3: Update action ordering is mandatory

**What:** The CT update actions returned by the extension must follow this exact order:

1. `setCustomType` — stores all `connectorStripeTax_*` metadata fields (calculation references set, amounts, currencies, expiry markers, timestamp).
2. `setLineItemTotalPrice` — one per (line item × shippingKey).
3. `setLineItemTaxAmount` — one per (line item × shippingKey); must follow its `setLineItemTotalPrice`.
4. `setShippingMethodTaxAmount` — one per shipping method (with `shippingKey` in Multiple mode; without in Single mode).
5. `setCartTotalTax` — sets `externalTotalGross` (skipped only if `amount_total <= 0`).

**Why:** CT processes update actions sequentially. `setLineItemTaxAmount` cannot be applied before `setLineItemTotalPrice` because `setLineItemTotalPrice` switches the line item's `priceMode` to `ExternalTotal`, which then **requires** `externalTaxAmount` to be set. CT will reject the update if this order is violated.

**Invariant:** Every line item that receives `setLineItemTotalPrice` must also receive `setLineItemTaxAmount` (even if tax is zero). The `ensureMissingTaxActions()` helper synthesizes a `tax = 0` action for any line item that ended up with a total-price action but no matching tax breakdown.

**Implementation:** `update-action.service.js` → `createCartUpdateActionsFromMultipleCalculations()`. Helper methods: `createLineItemTotalPriceActions()`, `createLineItemTaxUpdateActions()`, `ensureMissingTaxActions()`, `createMultipleShippingTaxUpdateActions()` / `createShippingTaxUpdateAction()`, `createCartTotalTaxAction()`.

**What breaks if violated:** CT returns a validation error and rejects the entire cart update. All tax data is lost for that cart update.

---

## Rule 4: Parallel calculations with graceful partial failure

**What:** All Stripe tax calculation requests are executed simultaneously via `Promise.allSettled()`. If some fail and others succeed, processing continues with the successful ones. Only if ALL calculations fail is an error thrown.

**Why:** In Multiple shipping mode or with multiple ship-from groups, several Stripe API calls are needed. Running them sequentially would exceed the 2-second timeout. `Promise.allSettled` prevents one failed calculation from blocking the others.

**Invariant:** Never use `Promise.all()` for Stripe calculations — a single failure would abort all calculations. Always use `Promise.allSettled()`.

**Implementation:** `tax-orchestrator.service.js` → `executeTaxCalculations()`

**What breaks if violated:** With `Promise.all()`, a single transient Stripe error fails the entire tax calculation for all line items, blocking checkout. With all-fail guard removed, partial failures produce incorrect CT updates (missing tax for some line items).

---

## Rule 5: Calculation references must be written via setCustomType in the same response

**What:** The Stripe Calculation IDs (one or more, since each ship-from group × shipping method produces a separate Stripe call) are written to the custom field `connectorStripeTax_calculationReferences` (a `Set of String`) via the first `setCustomType` action in the response. The same action also writes amount totals, currencies, expiry markers, and a timestamp. This must be present before the cart becomes an order, so the references carry over to the order's custom fields.

**Why:** The order-syncer reads `connectorStripeTax_calculationReferences` from the order's custom fields to create Stripe Tax transactions. If the references are missing when the order is created, no transaction can be created and the sale is not recorded in Stripe Tax for reporting.

**Invariant:** The `setCustomType` action is always the first action in the response. It must be included even if subsequent actions are skipped.

**Implementation:** `update-action.service.js` → `createCartCustomTypeUpdateAction(combinedCalculation)` — pushed first into `updateActions[]` by `createCartUpdateActionsFromMultipleCalculations()`.

**What breaks if violated:** Orders are created without `connectorStripeTax_calculationReferences`. The order-syncer logs `Order ${id} has no calculation references. Skipping.` and never creates Stripe Tax transactions. The sale is missing from Stripe Tax reports, causing compliance gaps.

---

## Rule 6: Shipping tax behavior follows the same resolved behavior as line items

**What:** Shipping cost `tax_behavior` in the Stripe request is set to the same value resolved for the cart's line items — country-based mapping first (`TAX_BEHAVIOR_COUNTRY_MAPPING`), then merchant-wide default, then omitted entirely to let Stripe apply its own default. Shipping never uses a different rule than line items.

**Why:** `TAX_BEHAVIOR_COUNTRY_MAPPING` exists so operators can match each jurisdiction's display convention (VAT-inclusive vs. exclusive). An operator configuring a country as inclusive expects *all* cart amounts — including shipping — to render consistently; a cart showing inclusive line items next to exclusive shipping is a visible, confusing inconsistency, not a deliberate design choice.

**Invariant:** Shipping's `tax_behavior` must always equal the behavior resolved for the line items **in the same request** — never a hardcoded literal, and never the behavior of a different destination. Since 2026-09-17 that value is resolved per destination rather than once per cart, so in Multiple shipping mode each request carries its own: a cart delivering to two countries taxes each shipment, and its shipping line, under the convention of the country it goes to.

**Implementation:** `tax-orchestrator.service.js` → `createSingleRequestForGroup()` (Single shipping mode) and `populateRequestWithLineItems()` (Multiple shipping mode) — both read `taxBehaviors[group.lineItems[0]?.id]` and set `shipping_cost.tax_behavior` only if a behavior was determined, mirroring the line item logic exactly.

**What breaks if violated:** Reverting to a hardcoded value (in either direction) reintroduces the inconsistency this rule was corrected to fix — shipping tax display diverging from the country-configured behavior operators explicitly set for the rest of the cart.

**Corrected 2026-07-28** (was previously hardcoded to `'exclusive'` unconditionally — see `../known-issues.md` Issue 7, resolved same day). Regression tests: `tax-calculator/test/unit/services/tax-orchestrator.service.spec.js` → `createSingleRequestForGroup` and `createSeparatedRequestsByShippingKey` describe blocks.

**Amended 2026-09-17** — the country that keys the mapping is now the **delivery destination**, not `cart.country`. `cart.country` is shopper-controlled and means price selection, so keying on it let a shopper choose the behavior: forcing `inclusive` on a price published as exclusive makes Stripe carve the tax out of the amount instead of adding it, and the merchant remits it from their own margin. See `../decisions/adr-007-tax-destination-country.md` and `../known-issues.md` Issue 26. Regression tests: `tax-calculator/test/unit/services/tax-destination-country.spec.js`.
