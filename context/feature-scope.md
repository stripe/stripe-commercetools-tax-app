# Feature Scope — commercetools Stripe Tax Connector

What this connector supports, what it does not support, and what is partially supported. An LLM consulting this document should answer "not in scope for this connector" rather than inferring from general Stripe Tax knowledge.

## At a glance

| Area | Supported |
| --- | --- |
| [Tax calculation](#tax-calculation) | real-time, Single and Multiple shipping, inclusive/exclusive by country |
| [Tax code resolution](#tax-code-resolution) | category custom field |
| [Ship-from address](#ship-from-address) | channel → inventory → default address |
| [Order sync](#order-sync-stripe-tax-reporting) | one Stripe transaction per calculation reference |
| [Extension trigger](#ct-api-extension-trigger) | cart create/update under `ExternalAmount` |
| [Address validation](#address-validation) | standalone endpoint |
| [Out of scope](#out-of-scope-for-this-connector) | payments, refunds, webhooks, VAT-ID, renewals, non-`ExternalAmount` |

---

## Tax Calculation

| Feature | Status | Notes |
| --- | --- | --- |
| Real-time tax calculation on cart update | ✅ Supported | Via CT API Extension (synchronous); must respond within 2 seconds (`tax-calculator/src/connectors/action.js:34`) |
| Several calculations per cart | ✅ Supported | One Stripe calculation per ship-from group, and per shipping key in Multiple mode, run in parallel via `Promise.allSettled()` |
| Inclusive tax behavior | ✅ Supported | Per-country configuration via `TAX_BEHAVIOR_COUNTRY_MAPPING` |
| Exclusive tax behavior | ✅ Supported | Shipping follows the same resolved behavior as line items (`business-rules/tax-calculation.md` Rule 6, *Shipping tax behavior follows the same resolved behavior as line items*) |
| No behavior configured | ✅ Supported | `tax_behavior` is omitted and the Stripe account default applies (`business-rules/tax-behavior.md` Rule 3, *When no behavior is resolved, no `tax_behavior` is sent and the provider's account default applies*) |
| Multiple shipping mode | ✅ Supported | One request per ship-from group × shipping key; line items split by target quantity |
| Single shipping mode | ✅ Supported | One request per ship-from group |
| Several ship-from origins in one cart | ✅ Supported | One Stripe calculation per ship-from origin |
| Tax destination | ✅ Supported | The delivery address (`business-rules/tax-destination.md`) |
| Stripe Tax as calculation engine | ✅ Supported | Stripe Tax is the source of truth for all tax amounts |
| Tax calculation for excluded territories | ❌ Not implemented | See `business-rules/unsupported-territories.md` |
| Manual tax rate override | ❌ Not implemented | — |

---

## Tax Code Resolution

| Feature | Status | Notes |
| --- | --- | --- |
| CT product category → Stripe Tax code (category custom type) | ✅ Supported | The only active strategy; the first direct category with a value wins |
| Product-level custom type tax code | ❌ Not supported | — |
| CT category mapping JSON lookup | ❌ Not supported | `TAX_CODE_CATEGORY_MAPPING_JSON` is used only at post-deploy validation |
| Parent category traversal | ❌ Not supported | — |
| Missing tax code | ⚠️ Refuses the cart | 400 `TaxCodeNotFoundError` |
| Shipping tax code | ✅ Supported | From the shipping method's custom field |
| In-memory category cache | ✅ Supported | 5-minute TTL |
| Automatic tax code detection (no mapping required) | ❌ Not supported | A category custom type field is required on every participating category |

---

## Ship-From Address

| Feature | Status | Notes |
| --- | --- | --- |
| Channel-based ship-from address | ✅ Supported | From the line item's supply channel |
| Inventory-based ship-from address | ✅ Supported | Priority-ordered via `SHIP_FROM_CHANNEL_PRIORITY`, else most stock |
| Default business address | ✅ Supported | Via `SHIP_FROM_DEFAULT_BUSINESS_*` env vars, used only when `SHIP_FROM_REQUIRED='true'` |
| Optional mode | ✅ Supported | An unresolved item is sent without `ship_from_details` |
| Automatic warehouse address detection | ❌ Not supported | Must be configured via env vars or CT channels |

---

## Order Sync (Stripe Tax Reporting)

| Feature | Status | Notes |
| --- | --- | --- |
| Sync created CT orders to Stripe Tax transactions | ✅ Supported | Via async Pub/Sub on `OrderCreated` (order-syncer component) |
| Stripe Tax transaction creation from calculation references | ✅ Supported | Reads `connectorStripeTax_calculationReferences` from CT order; `reference` = the calculation id |
| Multiple calculation references per order | ✅ Supported | One Stripe transaction per reference in sequence |
| Orders without calculation references | ⚠️ Skipped | Logged as `Order ${id} has no calculation references. Skipping.`; returns 204 (acknowledged) |
| PaymentIntent metadata | ✅ Best-effort | `tax_transactions` written on the first payment's `interfaceId` |

The full table of statuses and what is redelivered is `business-rules/order-sync.md` Rule 5.

---

## CT API Extension Trigger

| Feature | Status | Notes |
| --- | --- | --- |
| Triggers on cart create/update | ✅ Supported | When all trigger conditions are met (`tax-calculator/src/connectors/action.js:31`) |
| Requires `taxMode=ExternalAmount` | ✅ Required | Extension does not fire for other tax modes |
| Requires line items with shipping | ✅ Required | Empty carts, and carts with neither `shippingInfo` nor line-item `shippingDetails`, are skipped |
| Carts with `paymentInfo` attached | ✅ Skipped, with one exception | Skipped as a rule; but when commercetools has cleared `taxedPrice` (or Single-mode `shippingInfo.taxedPrice`) and a calculation reference exists, the extension fires and the stored calculation is re-applied or recalculated (`business-rules/tax-calculation.md` Rule 2, *Extension trigger filters on tax mode, line items, change set, and payment state*) |
| Triggers when `cartState=Frozen` | ❌ Not part of trigger | Frozen state is not a trigger condition |

---

## Address Validation

| Feature | Status | Notes |
| --- | --- | --- |
| Standalone address validation endpoint | ✅ Supported | `POST /taxCalculator/validateAddress`; local rules first, then a Stripe calculation |

---

## Integration with Payment Connectors

| Integration | Status | Notes |
| --- | --- | --- |
| Payment connectors reading the calculation reference | ✅ Supported, outside this code | This connector writes `connectorStripeTax_calculationReferences` on the cart; a payment connector may read it and attach the calculation to the PaymentIntent. That contract is defined at the integration level, not here — see `adopter-guide.md` §4 |

---

## Out of Scope for This Connector

| Feature | Why |
| --- | --- |
| Payment processing | Tax calculation and reporting only |
| Tax calculation for excluded territories | Not implemented |
| EU VAT number validation | Not implemented |
| Tax registration or compliance advice | Outside connector scope |
| EU VAT OSS reporting | Not implemented |
| Manual tax rate mapping | Not implemented |
| Tax for `cartState=Frozen` carts | Not a trigger condition |
| Real-time tax for non-`ExternalAmount` tax modes | Extension only fires for `taxMode=ExternalAmount` |
| Tax refunds / transaction reversals | Not implemented in order-syncer |
| Stripe webhooks | None registered; order sync is driven by CT Pub/Sub only |
| Subscription renewal tax calculation | Tax calculated per cart only; renewal invoices not re-taxed |
| Stripe Tax for non-CT commerce platforms | This connector is CT-specific |

The fuller list is `adopter-guide.md` §2, "What this connector does not do".
