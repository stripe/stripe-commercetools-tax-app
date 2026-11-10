# commercetools Stripe Tax Connector — Adopter Guide

> Who this is for: teams deploying the commercetools Stripe Tax Connector for real-time Stripe Tax calculation on CT carts.
> For connector internals see `context/ARCHITECTURE.md`. For how another application calls the
> address-check endpoint, see `context/host-integration.md`.

---

## 1. Prerequisites

Before deploying, confirm you have:

**commercetools:**
- CT project on **commercetools Connect**, with API client credentials (client ID, client secret,
  project key, scope). The connector validates their shape at runtime: client ID exactly 24
  characters, client secret exactly 32 (`tax-calculator/src/validators/env-var.validators.js:15-33`).
- Carts configured with `taxMode=ExternalAmount` — the extension does not fire for any other tax mode
- CT product categories populated with `connectorStripeTax_TaxCode` custom fields (set up in
  Installation Step 4 — the field exists only once installation has created it)

**Stripe:**
- Stripe account with **Stripe Tax enabled** — activate in Stripe Dashboard → Settings → Tax before deploying
- **A head office address configured in Stripe Tax.** Installation fails without it: post-deploy
  requires Stripe Tax `status` = `active` and a `head_office`
  (`tax-calculator/src/validators/stripeTaxValidator.js:47-66`, called from
  `tax-calculator/src/connectors/post-deploy.js:37`)
- Stripe secret key (`sk_test_...` or `sk_live_...`)

**Infrastructure:**
- Nothing beyond Connect. The Pub/Sub topic that delivers orders to `order-syncer` is supplied by
  Connect to the post-deploy script as `CONNECT_GCP_TOPIC_NAME` / `CONNECT_GCP_PROJECT_ID`
  (`order-syncer/src/connectors/post-deploy.js:16-25`). Post-deploy creates a **commercetools**
  subscription whose destination is the topic Connect supplies
  (`order-syncer/src/connectors/action.js:22-40`).

---

## 2. What This Connector Deploys

Post-deploy creates these resources automatically:

| Component | Type | What it does |
| --- | --- | --- |
| `tax-calculator` | Connect `service` application, endpoint `/taxCalculator` (`connect.yaml:2-4`) | Computes cart tax; also serves the address check |
| `order-syncer` | Connect `event` application, endpoint `/orderSyncer` (`connect.yaml:55-57`) | Commits Stripe Tax transactions when orders are created |
| CT API Extension `ctpTaxCalculatorExtension` | CT Extension (cart, `Create`/`Update`) | Triggers synchronous Stripe Tax calculation on cart create/update (2-second timeout) |
| `connector-stripe-tax-calculation-reference` | CT Custom Type, declared for resource type `order` (`tax-calculator/src/connectors/customTypes.js:114-121`); the connector sets it on carts, and the order-syncer adds its field to the same key | Stores `connectorStripeTax_calculationReferences` (plus amounts, currencies, expiry, timestamp and destination country) and `connectorStripeTax_transactionReferences` |
| `connector-stripe-tax-product` | CT Custom Type (product-price, line-item) | `connectorStripeTax_TaxCode` field — created at install but not read at runtime |
| `connector-stripe-tax-category` | CT Custom Type (category) | `connectorStripeTax_TaxCode` for per-category tax code — **this is the primary tax code source** |
| `connector-stripe-tax-shipping` | CT Custom Type (shipping-method) | `connectorStripeTax_TaxCode` for shipping method tax code |
| CT subscription `ct-connect-tax-integration-order-change-subscription` | commercetools Subscription, destination Google Cloud Pub/Sub | Receives `OrderCreated` CT events; pushes to order-syncer for Stripe Tax transaction commit |

> **Installation also changes types you own.** For each of the four resource types (`product-price`,
> `category`, `shipping-method`, `order`), post-deploy adds the connector's field definitions to
> **every existing type of that resource type**, not only to the connector's own keys
> (`tax-calculator/src/connectors/action.js:290-321`; `order-syncer/src/connectors/action.js:107-138`).
> Uninstalling removes them again. See `business-rules/deploy-lifecycle.md`.

**What this connector does not do:**
- **No payment processing** — no PaymentIntent is created, confirmed or captured here; payment belongs to
  the integration's payment connectors. The only payment call is a metadata update (§4).
- **No refunds or transaction reversals** — `order-syncer` only creates transactions.
- **No Stripe webhooks** — order sync is driven by the commercetools subscription only.
- **No EU VAT number (tax ID) validation**, no **tax registration or compliance advice**, and no **EU VAT
  OSS reporting**.
- **No manual tax-rate override** — every rate comes from a Stripe Tax calculation.
- **No subscription-renewal tax** — tax is calculated per cart.
- **No tax for carts outside `taxMode=ExternalAmount`** (§1).
- **One deployment per commercetools project** — the extension key is fixed
  (`tax-calculator/src/connectors/constants.js:2`), and a second deployment deletes and recreates it
  (`tax-calculator/src/connectors/action.js:42-56`).
- **No special handling of excluded territories** — see `business-rules/unsupported-territories.md`.

---

## 3. Installation

### Step 1 — Install (deploy via CT Connect)

Deploy the connector through the CT Connect marketplace, with the configuration in Step 2. The
manifest is `connect.yaml` at the repository root. The post-deploy script runs automatically and
creates the resources listed above, in this order: Stripe Tax check → tax-code mapping check →
custom types → API extension; then, for `order-syncer`, subscription → order type
(`tax-calculator/src/connectors/post-deploy.js:37-70`; `order-syncer/src/connectors/post-deploy.js:19-26`).

### Step 2 — Configure environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `STRIPE_API_TOKEN` | **Yes** | Stripe secret API key — note: different variable name from payment connectors (`STRIPE_SECRET_KEY`) |
| `CTP_PROJECT_KEY` | **Yes** | CT project key |
| `CTP_REGION` | **Yes** | CT region code, one of `us-central1.gcp`, `us-east-2.aws`, `europe-west1.gcp`, `eu-central-1.aws`, `australia-southeast1.gcp` — note: different from `CTP_AUTH_URL` used by payment connectors |
| `CTP_CLIENT_ID` | **Yes** | CT API client ID (24 characters) |
| `CTP_CLIENT_SECRET` | **Yes** | CT API client secret (32 characters) |
| `CTP_SCOPE` | **Yes** (manifest) | CT scope. Declared required in `connect.yaml:84-86`; treated as optional at runtime, falling back to `default` (`tax-calculator/src/middlewares/auth.middleware.js:15`) |
| `TAX_CODE_CATEGORY_MAPPING_JSON` | **Yes** (manifest) | Declared required (`connect.yaml:32-34`) and checked at install only. Tax codes are resolved from the category custom field, not from this variable. Its shape is under "The category mapping JSON" below |
| `TAX_BEHAVIOR_DEFAULT` | No | `inclusive` or `exclusive` (default: `exclusive`) |
| `TAX_BEHAVIOR_COUNTRY_MAPPING` | No | JSON map of country code → behavior (e.g. `{"DE":"inclusive","FR":"inclusive"}`). Keys must be **upper-case** — the lookup upper-cases the destination country and never the keys (`tax-calculator/src/services/tax-behavior.service.js:88`). Default in the manifest maps 9 countries (`connect.yaml:29-31`) |
| `SHIP_FROM_REQUIRED` | No (manifest default `'true'`, `connect.yaml:35-37`) | `'true'` to require a resolved ship-from address per line item. Exactly `'true'` (lower case) turns on required mode: a line item with no channel address is taxed from the default address below. Any other value leaves such items without a ship-from (`tax-calculator/src/services/ship-from.service.js:57-63`) |
| `SHIP_FROM_DEFAULT_BUSINESS_COUNTRY` | **Configure if `SHIP_FROM_REQUIRED=true`** | Default ship-from country (ISO 2-letter). Defaults to `US` |
| `SHIP_FROM_DEFAULT_BUSINESS_STATE` | as above | Default ship-from state. Defaults to `NY` |
| `SHIP_FROM_DEFAULT_BUSINESS_CITY` | as above | Default ship-from city. Defaults to `New York` |
| `SHIP_FROM_DEFAULT_BUSINESS_POSTAL_CODE` | as above | Default ship-from postal code. Defaults to `10001` |
| `SHIP_FROM_DEFAULT_BUSINESS_LINE1` | as above | Default ship-from street. Defaults to empty |
| `SHIP_FROM_DEFAULT_BUSINESS_LINE2` | as above | Default ship-from second line. Defaults to empty |
| `SHIP_FROM_CHANNEL_PRIORITY` | No | Comma-separated channel IDs, preferred when an inventory-based origin is chosen |
| `ADDRESS_VALIDATION_STRIPE_DEFAULT_CURRENCY` | No (default `usd`) | Currency of the address-check probe for countries outside the built-in map (`tax-calculator/src/services/address.service.js:136-139`) |
| `CUSTOM_TYPE_CART_KEY` / `CUSTOM_TYPE_ORDER_KEY` | Yes (defaulted) | **Must be identical.** Both default to `connector-stripe-tax-calculation-reference` |
| `CUSTOM_TYPE_PRODUCT_KEY` / `CUSTOM_TYPE_CATEGORY_KEY` / `CUSTOM_TYPE_SHIPPING_KEY` | Yes (defaulted) | Keys of the types created at install |

#### The category mapping JSON (install-time check only)

If you set `TAX_CODE_CATEGORY_MAPPING_JSON`, post-deploy parses it and checks that every listed
category exists; it fails the install on invalid JSON or a missing category
(`tax-calculator/src/connectors/post-deploy.js:45-57`, `tax-calculator/src/connectors/action.js:239-261`).
The shape it checks is:

```json
{
  "categories": [
    { "ctCategory": { "id": "ct-category-uuid-1" }, "taxCode": "txcd_10000000" },
    { "ctCategory": { "key": "ct-category-key-2" }, "taxCode": "txcd_20030000" }
  ]
}
```

> Each entry identifies the category by CT category `id` **or** `key`
> (`tax-calculator/src/connectors/action.js:131-149`). Get them from CT Merchant Center → Catalog →
> Categories or via the CT API. A JSON object with no `categories` array passes the check as an
> empty mapping (`:241-244`).

### Step 3 — Verify post-deploy resources

| Resource | Identifier | Purpose |
| --- | --- | --- |
| API extension | `ctpTaxCalculatorExtension`, `timeoutInMs: 2000` (`tax-calculator/src/connectors/action.js:21-35`) | cart tax |
| Subscription | `ct-connect-tax-integration-order-change-subscription`, message `OrderCreated` | order sync |
| Type | `connector-stripe-tax-product` (`product-price`, `line-item`) | tax-code field — not read at runtime |
| Type | `connector-stripe-tax-category` (`category`) | `connectorStripeTax_TaxCode` — **the** tax-code source |
| Type | `connector-stripe-tax-shipping` (`shipping-method`) | shipping tax code |
| Type | `connector-stripe-tax-calculation-reference` (`order`) | calculation and transaction references |

In CT Merchant Center → Settings → Developer → API:
- Extensions: CT API Extension registered with trigger condition `taxMode=ExternalAmount` (the full
  condition is in `business-rules/tax-calculation.md` Rule 2)
- Custom Types: `connector-stripe-tax-calculation-reference`, `connector-stripe-tax-product`, `connector-stripe-tax-category`, `connector-stripe-tax-shipping` all exist

Or through the API: `GET /{projectKey}/extensions/key=ctpTaxCalculatorExtension` returns the
extension.

### Step 4 — Prepare your CT categories (and shipping methods)

Every CT product category that participates in tax calculation must have `connectorStripeTax_TaxCode` set to a valid Stripe tax code.

**Critical:** Only the category-level custom type field is read. Set `connectorStripeTax_TaxCode`
directly on every participating category; product-level fields and parent-category inheritance are
not read.

Set the same field on your shipping methods (`connector-stripe-tax-shipping`); the shipping tax code
is read from the cart's shipping method (`tax-calculator/src/services/tax-code.service.js:262-272`).

Common Stripe tax codes:
- `txcd_10000000` — General physical goods
- `txcd_20030000` — Software as a service
- `txcd_99999999` — Non-taxable

---

## 4. Using the Connector

Once deployed, the connector operates automatically — no storefront SDK integration is needed.

**How it fires:** CT calls the extension synchronously whenever a cart is created or updated AND:
- Cart has `taxMode=ExternalAmount`
- Cart has at least one line item
- Cart has shipping info (cart `shippingInfo`, or `shippingDetails` on its line items)
- Cart does not yet have a payment attached — **or** a payment is attached, the platform has
  cleared the cart's tax, and a calculation reference is already stored (the re-apply case, below)
- A tax-relevant field changed (tax mode, line items, shipping info, shipping address, `shipping`,
  or item shipping addresses)

**What it writes to the cart:**
- `connectorStripeTax_calculationReferences` — Stripe Tax calculation ID(s) for this cart state.
  The integration's payment connectors also read this field when they create the payment; that
  contract is documented at the integration level, not in this repository.
- `connectorStripeTax_destinationCountry` — the country (or comma-separated countries, for a cart
  delivering to several) the calculation was made for. This field is an informational record only:
  the decision whether a stored calculation may be re-used compares the retrieved calculation's own
  delivery address against the cart's current one (see *After a payment is attached* below).
- `taxedPrice` — populated on the cart with the calculated amounts

> **Tax is determined by the delivery address, not by `cart.country`.** `cart.country` selects
> which catalog prices apply; the shipping address decides the tax jurisdiction and the
> inclusive/exclusive behavior. The two may legitimately differ — a shopper browsing one market
> and shipping to another — and the connector taxes where the goods go. In Multiple shipping mode
> each destination is taxed separately.
>
> If you set `TAX_BEHAVIOR_COUNTRY_MAPPING`, note it is keyed on the **delivery** country.

> **The connector replaces the cart's custom type.** Each fresh calculation sends `setCustomType`
> with the connector's type (`tax-calculator/src/services/update-action.service.js:199-216`). Any
> other custom type on the cart, and its field values, is replaced. If your carts carry their own
> custom type, plan for this before going live.

**After a payment is attached**

If the platform clears the cart's tax after a payment is attached — for example after an address
change — the connector retrieves the stored calculation and re-applies it (rather than recalculating),
**provided** the cart is in Single shipping mode and still delivers to the same jurisdiction (country +
state + city + postal code) the retrieved calculation was made for. A new calculation is made instead when
the cart is in Multiple shipping mode, when the stored calculation no longer exists at Stripe, or when the
jurisdiction has changed (`reapplyExistingCalculation()` in
`tax-calculator/src/services/tax-orchestrator.service.js`; `business-rules/tax-calculation.md` Rule 2).
Only the first stored reference is re-applied.

**What it writes to the order (on `OrderCreated`):**
- `connectorStripeTax_transactionReferences` — Stripe Tax transaction IDs committed from the calculation
- On the order's **first** payment, if it has an `interfaceId`, the Stripe PaymentIntent receives the
  metadata key `tax_transactions` with those IDs (`order-syncer/src/controllers/sync.controller.js:78,104-107`;
  `order-syncer/src/extensions/stripe/clients/client.js:83-93`).

> **Address validation endpoint:** `POST /taxCalculator/validateAddress` calls the Stripe Tax API and creates a real Stripe Tax calculation. Rate-limit calls if your storefront calls it frequently during address input.
> It is not part of cart tax: the extension never calls it. The request, the responses and what the
> result means are in `host-integration.md`.

---

## 5. Verification Checklist

- [ ] Create a CT cart with `taxMode=ExternalAmount`, add a line item, set a shipping address — `taxedPrice` should be populated on the cart
- [ ] Cart custom fields should include `connectorStripeTax_calculationReferences` with a valid Stripe calculation ID
- [ ] Place an order — within seconds, the order should receive `connectorStripeTax_transactionReferences` via Pub/Sub
- [ ] Stripe Tax Dashboard should show a committed transaction for the order — its `reference` is the
      calculation ID, with metadata `ct_order_id` (`order-syncer/src/extensions/stripe/clients/client.js:61-68`)
- [ ] Create a product in a category without `connectorStripeTax_TaxCode` — the cart update fails with
      400 `InvalidInput`, message "No tax code mapping found for product …"
      (`tax-calculator/src/errors/taxCodeNotFound.error.js:11-13,33-36`). This confirms the tax-code source.
- [ ] If `SHIP_FROM_REQUIRED=true`: an item with no supply channel is taxed from **your** configured
      address, not from New York.

---

## 6. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Cart updates but no tax calculated | `taxMode` not `ExternalAmount`, or CT API Extension not registered, or no shipping info on cart | Check cart `taxMode`; verify Extension in CT Merchant Center; ensure cart has line items and shipping |
| `TaxCodeNotFoundError` on every product | Categories missing `connectorStripeTax_TaxCode` | Set `connectorStripeTax_TaxCode` on each CT category directly; it is read only from the category's own field |
| Address validation exhausting Stripe Tax quota | UI calling `/taxCalculator/validateAddress` on every keystroke | Debounce or limit validation calls; each call creates a real Stripe Tax calculation |
| Tax computed from New York | `SHIP_FROM_REQUIRED=true` with no `SHIP_FROM_DEFAULT_BUSINESS_*` configured | Set `SHIP_FROM_DEFAULT_BUSINESS_*` |
| A country mapping is ignored | A lower-case key in `TAX_BEHAVIOR_COUNTRY_MAPPING` | Use upper-case country codes |
| `SHIP_FROM_REQUIRED` seems ignored | The value is not exactly `true` | Use lower-case `true` |
| A custom type you set on carts disappears | The connector's `setCustomType` replaces it (§4) | Move your fields onto the connector's cart type, or keep them elsewhere |
