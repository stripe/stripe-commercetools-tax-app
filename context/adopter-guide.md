# ct-stripe-tax — Adopter Guide

> Who this is for: teams deploying ct-stripe-tax for real-time Stripe Tax calculation on CT carts.
> For connector internals see `context/ARCHITECTURE.md`.
> Not sure which connector you need? See `ct-stripe/context/adopter-guide.md`.

---

## 1. Prerequisites

Before deploying, confirm you have:

**commercetools:**
- CT project with API client credentials (client ID, client secret, project key)
- Carts configured with `taxMode=ExternalAmount` — the extension does not fire for any other tax mode
- CT product categories populated with `connectorStripeTax_TaxCode` custom fields (set up in Step 3)

**Stripe:**
- Stripe account with **Stripe Tax enabled** — activate in Stripe Dashboard → Settings → Tax before deploying
- Stripe secret key (`sk_test_...` or `sk_live_...`)

**Google Cloud Platform:**
- GCP project with Pub/Sub API enabled
- IAM permissions to create Pub/Sub subscriptions (for order sync)

---

## 2. What This Connector Deploys

Post-deploy creates these resources automatically:

| Component | Type | What it does |
| --- | --- | --- |
| CT API Extension | CT Extension | Triggers synchronous Stripe Tax calculation on cart create/update (2-second timeout) |
| `connector-stripe-tax-calculation-reference` | CT Custom Type (cart + order) | Stores `connectorStripeTax_calculationReferences` and `connectorStripeTax_transactionReferences` |
| `connector-stripe-tax-product` | CT Custom Type (product-price, line-item) | `connectorStripeTax_TaxCode` for per-product tax code override |
| `connector-stripe-tax-category` | CT Custom Type (category) | `connectorStripeTax_TaxCode` for per-category tax code — **this is the primary tax code source** |
| `connector-stripe-tax-shipping` | CT Custom Type (shipping-method) | `connectorStripeTax_TaxCode` for shipping method tax code |
| GCP Pub/Sub subscription | GCP | Receives `OrderCreated` CT events; pushes to order-syncer for Stripe Tax transaction commit |

---

## 3. Installation

### Step 1 — Prepare your CT categories

Every CT product category that participates in tax calculation must have `connectorStripeTax_TaxCode` set to a valid Stripe tax code.

**Critical:** Only the category-level custom type field is active. Product-level fields and parent-category inheritance do NOT work. Set the field directly on every participating category.

Common Stripe tax codes:
- `txcd_10000000` — General physical goods
- `txcd_20030000` — Software as a service
- `txcd_99999999` — Non-taxable

### Step 2 — Build your category mapping JSON

Prepare the category mapping before deployment — it is validated at post-deploy time but not at startup:

```json
{
  "categories": [
    { "id": "ct-category-uuid-1", "taxCode": "txcd_10000000" },
    { "id": "ct-category-uuid-2", "taxCode": "txcd_20030000" }
  ]
}
```

> IDs must be CT category UUIDs (not keys). Get them from CT Merchant Center → Catalog → Categories or via the CT API.

### Step 3 — Deploy via CT Connect

Deploy `ct-stripe-tax` through the CT Connect marketplace. The post-deploy script runs automatically and creates the resources listed above.

### Step 4 — Configure environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `STRIPE_API_TOKEN` | **Yes** | Stripe secret API key — note: different variable name from payment connectors (`STRIPE_SECRET_KEY`) |
| `CTP_PROJECT_KEY` | **Yes** | CT project key |
| `CTP_REGION` | **Yes** | CT region code (e.g. `europe-west1`) — note: different from `CTP_AUTH_URL` used by payment connectors |
| `CTP_CLIENT_ID` | **Yes** | CT API client ID |
| `CTP_CLIENT_SECRET` | **Yes** | CT API client secret |
| `TAX_CODE_CATEGORY_MAPPING_JSON` | **Functionally required** | JSON from Step 2. Without this, every line item fails tax calculation silently at runtime. Not validated at startup. |
| `TAX_BEHAVIOR_DEFAULT` | No | `inclusive` or `exclusive` (default: `exclusive`) |
| `TAX_BEHAVIOR_COUNTRY_MAPPING` | No | JSON map of country code → behavior (e.g. `{"DE":"inclusive","FR":"inclusive"}`) |
| `SHIP_FROM_REQUIRED` | No | `'true'` to require a resolved ship-from address per line item |
| `SHIP_FROM_DEFAULT_BUSINESS_COUNTRY` | No | Default ship-from country (ISO 2-letter). Defaults to `US`. |
| `SHIP_FROM_DEFAULT_BUSINESS_STATE` | No | Default ship-from state. Defaults to `NY`. |
| `SHIP_FROM_DEFAULT_BUSINESS_CITY` | No | Default ship-from city. Defaults to `New York`. |
| `SHIP_FROM_DEFAULT_BUSINESS_POSTAL_CODE` | No | Default ship-from postal code. Defaults to `10001`. |
| `SHIP_FROM_DEFAULT_BUSINESS_LINE1` | No | Default ship-from street. Defaults to `1 Main St`. |

### Step 5 — Verify post-deploy resources

In CT Merchant Center → Settings → Developer → API:
- Extensions: CT API Extension registered with trigger condition `taxMode=ExternalAmount`
- Custom Types: `connector-stripe-tax-calculation-reference`, `connector-stripe-tax-product`, `connector-stripe-tax-category`, `connector-stripe-tax-shipping` all exist

---

## 4. Using the Connector

Once deployed, the connector operates automatically — no storefront SDK integration is needed.

**How it fires:** CT calls the extension synchronously whenever a cart is created or updated AND:
- Cart has `taxMode=ExternalAmount`
- Cart has at least one line item
- Cart has shipping info (address + shipping method)
- Cart does not yet have a payment attached
- A tax-relevant field changed (line items, shipping address, or shipping info)

**What it writes to the cart:**
- `connectorStripeTax_calculationReferences` — Stripe Tax calculation ID(s) for this cart state
- `connectorStripeTax_destinationCountry` — the country (or comma-separated countries, for a cart
  delivering to several) the calculation was made for. A stored calculation is only re-used while
  it still matches where the cart delivers; otherwise tax is recalculated.
- `taxedPrice` — populated on the cart with the calculated amounts

> **Tax is determined by the delivery address, not by `cart.country`.** `cart.country` selects
> which catalog prices apply; the shipping address decides the tax jurisdiction and the
> inclusive/exclusive behavior. The two may legitimately differ — a shopper browsing one market
> and shipping to another — and the connector taxes where the goods go. In Multiple shipping mode
> each destination is taxed separately.
>
> A consequence worth knowing before you go live: **a delivery address that has a city, postal
> code or street but no country is rejected** with a commercetools `InvalidInput` error naming the
> shipping method, rather than being completed from `cart.country`. commercetools requires
> `country` on every Address, so this should not occur through the normal cart API. A cart with no
> delivery address at all is unaffected and still calculates.
>
> If you set `TAX_BEHAVIOR_COUNTRY_MAPPING`, note it is keyed on the **delivery** country.

**What it writes to the order (on `OrderCreated`):**
- `connectorStripeTax_transactionReferences` — Stripe Tax transaction IDs committed from the calculation

> **Address validation endpoint:** `POST /taxCalculator/validateAddress` calls the Stripe Tax API and creates a real Stripe Tax calculation. Rate-limit calls if your storefront calls it frequently during address input.

---

## 5. Verification Checklist

- [ ] Create a CT cart with `taxMode=ExternalAmount`, add a line item, set a shipping address — `taxedPrice` should be populated on the cart
- [ ] Cart custom fields should include `connectorStripeTax_calculationReferences` with a valid Stripe calculation ID
- [ ] Place an order — within seconds, the order should receive `connectorStripeTax_transactionReferences` via Pub/Sub
- [ ] Stripe Tax Dashboard should show a committed transaction for the order
- [ ] Create a product in a category without `connectorStripeTax_TaxCode` — confirm the error appears in tax-calculator logs (not silently ignored)

---

## 6. Known Gaps

| Gap | What happens | Workaround |
| --- | --- | --- |
| Pub/Sub message not retried on failure | order-syncer returns HTTP 202 on errors; Pub/Sub treats this as success and discards the message | Manually commit the Stripe Tax transaction: get `connectorStripeTax_calculationReferences` from the CT order, call `POST /v1/tax/transactions` with `from_calculation`, then update the order |
| `TAX_CODE_CATEGORY_MAPPING_JSON` not validated at startup | If the env var is absent or malformed after a container restart, every cart update fails silently | Verify the env var is set on every deploy and restart |
| Partial calculation failures silently dropped | If one line item fails tax resolution, the remaining items still get tax data | Check tax-calculator logs for `TaxCodeNotFoundError` on specific products |
| Address validation creates real Stripe Tax calculations | Every call to `/taxCalculator/validateAddress` counts against your Stripe Tax quota | Rate-limit or debounce address validation calls in your UI |

---

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Cart updates but no tax calculated | `taxMode` not `ExternalAmount`, or CT API Extension not registered, or no shipping info on cart | Check cart `taxMode`; verify Extension in CT Merchant Center; ensure cart has line items and shipping |
| `TaxCodeNotFoundError` on every product | Categories missing `connectorStripeTax_TaxCode` | Set the field on each CT category directly; parent-category inheritance does not work |
| Some products taxed, others not | Partial failure silently dropped | Check tax-calculator logs for line-item errors; add missing tax codes to categories |
| Tax works but order has no Stripe Tax transaction | order-syncer `CustomError(202)` bug — message discarded | Manually commit via Stripe API (see Known Gaps above) |
| All products fail after a container restart | `TAX_CODE_CATEGORY_MAPPING_JSON` env var lost | Verify the env var is present in the deployment configuration |
| Address validation exhausting Stripe Tax quota | UI calling `/taxCalculator/validateAddress` on every keystroke | Debounce or limit validation calls; each call creates a real Stripe Tax calculation |
