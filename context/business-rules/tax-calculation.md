# Business Rule: Tax Calculation

## Overview

The tax-calculator runs as a CT API Extension — a synchronous callback that CT invokes before persisting a cart update. The response must be returned within the timeout window and must follow the exact CT update action format.

Related files: how requests are built (`calculation-requests.md`), how results become actions beyond the rules here (`calculation-results.md`), where the tax destination comes from (`tax-destination.md`), how `tax_behavior` is resolved (`tax-behavior.md`), and what the platform receives on failure (`error-responses.md`).

---

## Rule 1: The extension must respond within 2 seconds

**What:** CT's API Extension has a hard timeout of 2000ms. If the tax-calculator doesn't respond in time, CT treats it as a failure and the cart update is rejected.

**Why:** CT API Extensions are synchronous — they block the cart update. A slow response blocks the customer's checkout. The 2-second limit is enforced by CT, not the connector.

**Invariant:** The total execution time — category fetch + ship-from resolution + all Stripe calculations — must stay under 2 seconds. Parallel execution of Stripe calculations is non-negotiable; sequential execution would exceed the timeout for multi-item carts.

**Implementation:** `tax-orchestrator.service.js` — parallel execution via `Promise.allSettled()`, category cache with 5-min TTL to avoid repeated CT API calls. Line references: the timeout is registered at `tax-calculator/src/connectors/action.js:34`; calculations run in parallel at `tax-calculator/src/services/tax-orchestrator.service.js:641-654`; ship-from resolution runs in parallel at `tax-calculator/src/services/ship-from.service.js:23-29`; category cache TTL at `tax-calculator/src/services/category.service.js:24`.

---

## Rule 2: Extension trigger filters on tax mode, line items, change set, and payment state

**What:** The API Extension trigger condition (registered by `tax-calculator/src/connectors/action.js:31` → `createCTPExtension`) is:

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

The extension only fires when ALL clauses are true. The trigger is registered for `resourceTypeId: 'cart'` on `actions: ['Update', 'Create']` (`tax-calculator/src/connectors/action.js:29-30`).

**Why:** `taxMode=ExternalAmount` ensures the connector only runs when CT delegates tax to it. Requiring line items + shipping info means the cart actually has something to tax. The payment-state clause is no longer a simple exclusion — see the re-apply exception below. The "has changed" group prevents redundant calls when nothing tax-relevant changed.

**The payment-state clause has two cases:**

1. **Base case — `paymentInfo is not defined`:** the ordinary rule. Once a payment is attached to the cart, the extension stops firing — this still holds for the overwhelming majority of carts and is the correct mental model for "does this cart still get tax recalculated?"
2. **Re-apply exception:** commercetools clears `taxedPrice` (or `shippingInfo.taxedPrice` in Single shipping mode) after certain cart mutations — e.g. `setShippingAddress` — even when `paymentInfo` is already set. The widened condition lets the extension fire in this narrow case, **but only when a Stripe Tax calculation reference already exists** (`connectorStripeTax_calculationReferences` populated). `tax.calculator.controller.js`'s `isReapplyScenario()` detects this and re-applies the *existing* calculation (retrieved by ID) rather than creating a new one, keeping the PaymentIntent, cart, and `order-syncer` on the same `calculationId`.

   **Destination guard:** `reapplyExistingCalculation()` **retrieves the stored calculation first**, then compares the **retrieved calculation's own** `customer_details.address` (the address Stripe taxed, which a shopper cannot write) against the cart's current delivery address (`extractCustomerAddress(cart)`) at jurisdiction granularity — country + state + city + postal code, via `createAddressKey()` — and **falls back to a full recalculation** when the two keys differ. Before that comparison it also binds the retrieved calculation to **this cart**: the calculation must carry line items, and every one must be stamped with this cart's `metadata.cartId`; if it has no line items, or any line item's `metadata.cartId` is not this cart's, it recalculates rather than re-applies. The cart custom field `connectorStripeTax_destinationCountry` is written by `update-action.service.js` as an informational record. A **Multiple-mode** cart is not re-applied at all — it short-circuits to recalculation before the retrieve.

   *Retrieve-failure handling:* only a calculation Stripe reports as **missing** (`resource_missing` / HTTP 404) recalculates; any other `retrieve` error (auth, rate limit, connection, outage) is **re-thrown** and surfaces through the error mapping (`error-responses.md` Rule 6).

**Invariant:** If a cart with no payment attached is not triggering tax calculation, verify: `taxMode`, line items present, shipping/shippingDetails present, and that the relevant field actually changed. If a cart **with payment attached** unexpectedly triggers (or fails to trigger) recalculation, check whether it matches the re-apply exception — specifically whether `connectorStripeTax_calculationReferences` is already populated and whether `taxedPrice` was cleared by the preceding mutation.

**Implementation:** `tax-calculator/src/connectors/action.js:31` → `createCTPExtension()` (the JSON is built inline, not loaded from a separate `resources/api-extension.json`); `tax-calculator/src/controllers/tax.calculator.controller.js` → `isReapplyScenario()`; `tax-calculator/src/services/tax-orchestrator.service.js` → `reapplyExistingCalculation()`, which retrieves the stored calculation first and compares `calculation.customer_details.address` against `extractCustomerAddress(cart)` through `createAddressKey()` for the jurisdiction guard. Line references: `action.js:27-33`; `tax.calculator.controller.js:12-23`, `:66-68`; the guard is in `reapplyExistingCalculation()` (Multiple short-circuit, `retrieve`, `createAddressKey()` comparison).

---

## Rule 3: Update action ordering is mandatory

**What:** The CT update actions returned by the extension must follow this exact order:

1. `setCustomType` — stores all `connectorStripeTax_*` metadata fields (calculation references set, amounts, currencies, expiry markers, timestamp) and the destination country the calculations were made for (`connectorStripeTax_destinationCountry`, `tax-calculator/src/services/update-action.service.js:214`).
2. `setLineItemTotalPrice` — one per (line item × shippingKey).
3. `setLineItemTaxAmount` — one per (line item × shippingKey); must follow its `setLineItemTotalPrice`.
4. `setShippingMethodTaxAmount` — one per shipping method (with `shippingKey` in Multiple mode; without in Single mode).
5. `setCartTotalTax` — sets `externalTotalGross` (skipped only if `amount_total <= 0`).

This is the order on a **fresh** calculation. A re-apply returns only steps 3–5, with no `setCustomType` and no `setLineItemTotalPrice`.

**Why:** CT processes update actions sequentially. `setLineItemTaxAmount` cannot be applied before `setLineItemTotalPrice` because `setLineItemTotalPrice` switches the line item's `priceMode` to `ExternalTotal`, which then **requires** `externalTaxAmount` to be set. CT will reject the update if this order is violated.

**Invariant:** Every line item that receives `setLineItemTotalPrice` must also receive `setLineItemTaxAmount` (even if tax is zero). The `ensureMissingTaxActions()` helper synthesizes a `tax = 0` action for any line item that ended up with a total-price action but no matching tax breakdown. A line item the provider returns without a matching breakdown receives a zero-tax action from `createLineItemActionsFromCalculation()` (`tax-calculator/src/services/update-action.service.js:706-718`).

The **country label** on both kinds of zero-tax action is read from the calculation — the first breakdown's jurisdiction, otherwise the destination Stripe echoes back — through `destinationCountryOf()` (`update-action.service.js:256-260`), and falls back to `'US'` only when the calculation names none (`:446`, `:693`). The amount is zero either way.

**Implementation:** `update-action.service.js` → `createCartUpdateActionsFromMultipleCalculations()`. Helper methods: `createLineItemTotalPriceActions()`, `createLineItemTaxUpdateActions()`, `ensureMissingTaxActions()`, `createMultipleShippingTaxUpdateActions()` / `createShippingTaxUpdateAction()`, `createCartTotalTaxAction()`. Line references: the five pushes in order at `tax-calculator/src/services/update-action.service.js:32`, `:38`, `:44`, `:50` / `:54`, `:62`; the back-fill at `:445-500`.

---

## Rule 4: Parallel calculations

**What:** All Stripe tax calculation requests are executed simultaneously via `Promise.allSettled()`.

**Why:** In Multiple shipping mode or with multiple ship-from groups, several Stripe API calls are needed. Running them sequentially would exceed the 2-second timeout.

**Invariant:** Stripe calculations always use `Promise.allSettled()`, never `Promise.all()`.

**Implementation:** `tax-orchestrator.service.js` → `executeTaxCalculations()`; `Promise.allSettled` at `tax-calculator/src/services/tax-orchestrator.service.js:641`.

---

## Rule 5: Calculation references must be written via setCustomType in the same response

**What:** The Stripe Calculation IDs (one or more, since each ship-from group × shipping method produces a separate Stripe call) are written to the custom field `connectorStripeTax_calculationReferences` (a `Set of String`) via the first `setCustomType` action in the response. The same action also writes amount totals, currencies, expiry markers, and a timestamp. This must be present before the cart becomes an order, so the references carry over to the order's custom fields.

**Why:** The order-syncer reads `connectorStripeTax_calculationReferences` from the order's custom fields to create Stripe Tax transactions.

**Invariant:** On a fresh calculation, the `setCustomType` action is the first action in the response, included even if subsequent actions are skipped.

**Implementation:** `update-action.service.js` → `createCartCustomTypeUpdateAction(combinedCalculation)` — pushed first into `updateActions[]` by `createCartUpdateActionsFromMultipleCalculations()`. Line references: `tax-calculator/src/services/update-action.service.js:31-32` (pushed first), `:199-217` (the action).

---

## Rule 6: Shipping tax behavior follows the same resolved behavior as line items

**What:** Shipping cost `tax_behavior` in the Stripe request is set to the same value resolved for the cart's line items — country-based mapping first (`TAX_BEHAVIOR_COUNTRY_MAPPING`), then merchant-wide default, then omitted entirely to let Stripe apply its own default. Shipping never uses a different rule than line items.

**Why:** `TAX_BEHAVIOR_COUNTRY_MAPPING` exists so operators can match each jurisdiction's display convention (VAT-inclusive vs. exclusive). An operator configuring a country as inclusive expects *all* cart amounts — including shipping — to render consistently.

**Invariant:** Shipping's `tax_behavior` must always equal the behavior resolved for the line items **in the same request** — never a hardcoded literal, and never the behavior of a different destination. That value is resolved per destination rather than once per cart, so in Multiple shipping mode each request carries its own: a cart delivering to two countries taxes each shipment, and its shipping line, under the convention of the country it goes to.

**Implementation:** `tax-orchestrator.service.js` → `createSingleRequestForGroup()` (Single shipping mode) and `populateRequestWithLineItems()` (Multiple shipping mode) — both read `taxBehaviors[group.lineItems[0]?.id]` and set `shipping_cost.tax_behavior` only if a behavior was determined, mirroring the line item logic exactly. Line references: `tax-calculator/src/services/tax-orchestrator.service.js:285` (Single), `:422` (Multiple); per-destination re-resolution at `:315-318`.

---

## Rule 7: Re-apply is chosen by a non-empty reference list, not by the field's presence

**What:** Inside the handler, a request is a **re-apply** only when all of these hold:
- `cart.paymentInfo != null`;
- either `!cart.taxedPrice`, or (`shippingMode === 'Single'` and `shippingInfo != null` and `!shippingInfo.taxedPrice`);
- `connectorStripeTax_calculationReferences?.length > 0`.

Otherwise it is a fresh calculation.

**Why:** Once a payment holds a calculation, a new calculation would desynchronise the payment from the cart (Rule 2). The length test keeps a re-apply from retrieving a reference that does not exist.

**Invariant:**
- `cart.paymentInfo != null` (`tax-calculator/src/controllers/tax.calculator.controller.js:19`).
- `(taxedPriceCleared || shippingTaxCleared)` (`:20`).
- `(cart.custom?.fields?.connectorStripeTax_calculationReferences?.length ?? 0) > 0` (`:21`).

**Implementation:** `tax-calculator/src/controllers/tax.calculator.controller.js:12-23`, `:66-68`.
