# ADR-003 — CT API Extension for Real-Time Tax Calculation

**Status:** Accepted  
**Date:** 2024

## Context

CT offers two extensibility mechanisms for reacting to cart changes:
- **API Extension** — synchronous hook that intercepts the CT API request and can modify the response before it returns to the caller
- **Subscriptions/Messages** — asynchronous event stream after a change has been committed

Tax calculation must happen **before** the CT cart is updated with totals — the cart must reflect the correct tax amounts for the UI to display accurate pricing.

## Decision

Use **CT API Extension** (synchronous) for tax calculation on cart create/update.

The extension is registered on deploy (`tax-calculator/src/connectors/post-deploy.js` calling `createCTPExtension` from `connectors/action.js`) and triggers on:

```json
{
  "resourceTypeId": "cart",
  "actions": ["Update", "Create"],
  "condition": "taxMode=\"ExternalAmount\" AND lineItems is defined AND lineItems is not empty AND (shippingInfo is defined OR lineItems(shippingDetails is defined)) AND paymentInfo is not defined AND (taxMode has changed OR lineItems has changed OR shippingInfo has changed OR shippingAddress has changed OR shipping has changed OR itemShippingAddresses has changed)",
  "timeoutInMs": 2000
}
```

(Earlier drafts of this ADR mentioned a `cartState=Frozen` clause; the implementation does not use cart state — it uses change-detection plus `paymentInfo is not defined` to avoid redundant calls.)

The extension returns CT update actions that CT applies atomically as part of the same request.

## Consequences

- Tax amounts are always up-to-date when the cart is read — no stale totals shown to the customer
- The **2-second timeout** is a hard constraint from CT — Stripe Tax must respond within ~1.5s to leave buffer for CT processing
- If the extension fails or times out, the entire cart update request fails — tax calculation is on the critical path
- The trigger condition (above) limits extension calls to carts in `taxMode=ExternalAmount` that have line items, have not yet attached payment, and have changed in a tax-relevant way — browse/add-to-cart on non-tax-relevant fields is not affected
- CT must be configured with `taxMode: ExternalAmount` on the cart — this connector does not work with CT's built-in tax modes

## Alternatives Considered

| Option | Reason rejected |
|---|---|
| CT Subscription (async) | Tax amounts would only be updated after the cart is committed; UI would show incorrect totals |
| Client-side tax calculation | Requires Stripe secret key on the client — not acceptable |
| Pre-calculated taxes on product level | Cannot handle address-specific tax rates or dynamic cart compositions |
