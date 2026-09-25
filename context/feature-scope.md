# Feature Scope — ct-stripe-tax

What this connector supports, what it does not support, and what is partially supported or has known gaps. An LLM consulting this document should answer "not in scope for this connector" rather than inferring from general Stripe Tax knowledge.

---

## Tax Calculation

| Feature | Status | Notes |
| --- | --- | --- |
| Real-time tax calculation on cart update | ✅ Supported | Via CT API Extension (synchronous); must respond within 2 seconds |
| Multiple line items in a single request | ✅ Supported | Calculated in parallel via `Promise.allSettled()` — partial failures are silently dropped (see `known-issues.md` Issue 5) |
| Inclusive tax behavior | ✅ Supported | Per-country configuration via `TAX_BEHAVIOR_COUNTRY_MAPPING` |
| Exclusive tax behavior | ✅ Supported | Default; shipping now follows the same resolved behavior as line items (corrected 2026-07-28, see `business-rules/tax-calculation.md` Rule 6) |
| Multiple shipping addresses (Multiple shipping mode) | ✅ Supported | Each ship-from group produces a separate Stripe Tax calculation |
| Single shipping mode | ✅ Supported | — |
| Stripe Tax as calculation engine | ✅ Supported | Stripe Tax is the source of truth for all tax amounts |
| Tax calculation for excluded territories | ❌ Not implemented | Requests pass through to Stripe Tax as-is; see `business-rules/unsupported-territories.md` |
| Manual tax rate override | ❌ Not implemented | No mechanism to bypass Stripe Tax |

---

## Tax Code Resolution

| Feature | Status | Notes |
| --- | --- | --- |
| CT product category → Stripe Tax code (category custom type) | ✅ Supported | Strategy 1 — the only active strategy |
| Product-level custom type tax code | ❌ Commented out | Strategy 2 — defined but inactive (see `known-issues.md` Issue 8) |
| CT category mapping JSON lookup | ❌ Commented out | Strategy 3 — `TAX_CODE_CATEGORY_MAPPING_JSON` has no effect on line item resolution; used only at post-deploy validation |
| Parent category traversal | ❌ Commented out | Strategy 4 — inactive |
| In-memory category cache | ✅ Supported | 5-minute TTL to reduce CT API calls |
| Automatic tax code detection (no mapping required) | ❌ Not supported | A category custom type field is required on every participating category |

---

## Ship-From Address

| Feature | Status | Notes |
| --- | --- | --- |
| Default business address | ✅ Supported | Via `SHIP_FROM_DEFAULT_BUSINESS_*` env vars |
| Channel-based ship-from address | ✅ Supported | Priority-ordered via `SHIP_FROM_CHANNEL_PRIORITY` |
| Dynamic ship-from resolution per line item | ✅ Supported | Multi-strategy resolution; see `business-rules/ship-from.md` |
| Automatic warehouse address detection | ❌ Not supported | Must be configured via env vars or CT channels |

---

## Order Sync (Stripe Tax Reporting)

| Feature | Status | Notes |
| --- | --- | --- |
| Sync completed CT orders to Stripe Tax transactions | ✅ Supported | Via async Pub/Sub (order-syncer component) |
| Stripe Tax transaction creation from calculation references | ✅ Supported | Reads `connectorStripeTax_calculationReferences` from CT order |
| Multiple calculation references per order | ✅ Supported | One Stripe transaction per calculation reference — first failure in loop aborts remaining (see `known-issues.md` Issue 17) |
| Orders without calculation references | ⚠️ Skipped | Logged as `Order ${id} has no calculation references. Skipping.`; returns 202 (Pub/Sub discards) |
| Failed transaction commit | ⚠️ Data loss risk | Returns 202 on failure — Pub/Sub discards; no retry (see `known-issues.md` Issue 18) |

---

## CT API Extension Trigger

| Feature | Status | Notes |
| --- | --- | --- |
| Triggers on cart create/update | ✅ Supported | When all trigger conditions are met |
| Requires `taxMode=ExternalAmount` | ✅ Required | Extension does not fire for other tax modes |
| Requires line items with shipping | ✅ Required | Empty or unshipped carts are skipped |
| Skips carts with `paymentInfo` attached | ✅ Supported | Avoids re-taxing after payment is initiated |
| Triggers when `cartState=Frozen` | ❌ Not part of trigger | Frozen state is not a trigger condition |

---

## Address Validation

| Feature | Status | Notes |
| --- | --- | --- |
| Standalone address validation endpoint | ✅ Supported | `POST /taxCalculator/validateAddress` |
| Authentication on validation endpoint | ❌ None | Any HTTP caller can trigger validation (see `known-issues.md` Issue 6) |
| Quota impact | ⚠️ Warning | Each call creates a real Stripe Tax calculation that counts against monthly quota (see `known-issues.md` Issue 3) |

---

## Integration with Payment Connectors

| Integration | Status | Notes |
| --- | --- | --- |
| ct-connect-stripe-checkout | ✅ Supported | Checkout connector reads `connectorStripeTax_calculationReferences` from CT cart and forwards to Stripe PI when exactly one reference is present |
| ct-connect-stripe-composable | ✅ Supported | Same integration as checkout |

---

## Out of Scope for This Connector

| Feature | Why |
| --- | --- |
| Tax calculation for excluded territories | Not implemented — requests pass through to Stripe Tax with undefined behavior |
| EU VAT number validation | Not implemented |
| Tax registration or compliance advice | Outside connector scope |
| Manual tax rate mapping | Not implemented |
| Tax for `cartState=Frozen` carts | Not a trigger condition |
| Tax calculation without a ship-from address | `SHIP_FROM_REQUIRED` env var controls behavior; undefined without configuration |
| Real-time tax for non-`ExternalAmount` tax modes | Extension only fires for `taxMode=ExternalAmount` |
| Tax refunds / transaction reversals | Not implemented in order-syncer |
| Subscription renewal tax calculation | Tax calculated per cart only; renewal invoices not re-taxed |
| Stripe Tax for non-CT commerce platforms | This connector is CT-specific |
