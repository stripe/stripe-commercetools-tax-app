# commercetools SDK — Reference

> What this connector uses from this SDK. Not a complete reference.

## Version in use

`@commercetools/sdk-client-v2` (per `CLAUDE.md` Stack) — used by both `tax-calculator` and `order-syncer` independently (no shared client code between them; each module has its own `src/clients/`).

Pinned as `@commercetools/sdk-client-v2 ^2.2.0` together with `@commercetools/platform-sdk ^7.9.0`,
the typed request builder, in both `tax-calculator/package.json:34-35` and
`order-syncer/package.json:34-35`.

## What this unit uses it for

| Concept / Class | How this connector uses it |
| --- | --- |
| API Extensions | `tax-calculator` registers a synchronous cart Extension at post-deploy (`timeoutInMs: 2000`) — see `business-rules/tax-calculation.md` Rule 2, *Extension trigger filters on tax mode, line items, change set, and payment state* for the exact trigger condition |
| Pub/Sub Subscriptions | `order-syncer` registers a subscription on `OrderCreated` at post-deploy |
| Custom Types | Both modules create/read custom types on `cart`/`order`, `product-price`/`line-item`, `category`, and `shipping-method` resources — see `context/ARCHITECTURE.md` → CT Custom Types Created by the Connector. The cart/order type is declared for resource type `order` (`tax-calculator/src/connectors/customTypes.js:121`, `order-syncer/src/connectors/customTypes.js:22`) |
| `productProjections` | `tax-calculator` fetches product/category data for tax code resolution, cached 5 minutes |
| `channels`, `inventory` | `tax-calculator`'s ship-from resolution strategies |
| `shippingMethods` | `tax-calculator` reads the shipping method's `connectorStripeTax_TaxCode`, cached 5 minutes |
| `categories` | post-deploy checks that the categories named in `TAX_CODE_CATEGORY_MAPPING_JSON` exist |

Authentication and host: the client is built from `CTP_REGION` as `https://auth.{region}.commercetools.com`
and `https://api.{region}.commercetools.com` (`tax-calculator/src/middlewares/auth.middleware.js:9`,
`tax-calculator/src/middlewares/http.middleware.js:8-10`; same in `order-syncer`).

## Calls used

| Method | What it does | Where called in this connector |
| --- | --- | --- |
| `extensions().post()` / `.get()` / `.delete()` | Create/verify/remove the API Extension | `tax-calculator/src/connectors/action.js:37-56,75-90,97-121` |
| `subscriptions().post()` / `.get()` / `.delete()` | Create/verify/remove the Pub/Sub subscription | `order-syncer/src/connectors/action.js:14-82` |
| `types().post()` / `.get()` / `.delete()` | Create/verify/remove custom types (both modules) | `tax-calculator/src/connectors/action.js:290-358,392-436`; `order-syncer/src/connectors/action.js:90-251` |
| `orders().get()` / `.post()` | Read order + `paymentInfo` (expanding `paymentInfo.payments[*]`); write `connectorStripeTax_transactionReferences` via `setCustomField` | `order-syncer/src/clients/query.client.js:10-41`, `order-syncer/src/clients/update.client.js:13-36` |
| `productProjections().get()` | Fetch product/category data for tax code resolution | `tax-calculator/src/services/category.service.js:144-148` |
| `channels().withId().get()` | Supply-channel address for ship-from | `tax-calculator/src/services/ship-from.service.js:95-100` |
| `inventory().get()` | Inventory entries by SKU, with `supplyChannel` expanded | `tax-calculator/src/services/ship-from.service.js:124-133` |
| `shippingMethods().withId().get()` | Shipping method tax code | `tax-calculator/src/services/tax-code.service.js:288-293` |
| `categories().get()` | Category existence check at install | `tax-calculator/src/connectors/action.js:199-209` |

## Constraints that affect this unit

- **This connector uses `CTP_REGION`.** The region must be one of five values (`tax-calculator/src/validators/helpers.validators.js:124-136`).
- **The API Extension has a 2000ms timeout** — all tax calculation logic (category fetch, ship-from resolution, Stripe calls) must complete within that window (`business-rules/tax-calculation.md` Rule 1, *The extension must respond within 2 seconds*).
- **What the platform does with the extension's answer.** 200/201 carry update actions; 400 must
  carry an `errors` array; "All other status codes will be treated as a failure to respond
  properly", and a timeout fails the API call with `504 ExtensionNoResponse`
  (docs.commercetools.com/api/projects/api-extensions).

## What this unit deliberately does NOT use

- The cart API: `tax-calculator` never reads or writes carts directly — it receives the cart in the
  extension request and answers with update actions.
- GraphQL, store-scoped (`inStore`) endpoints, and the Import API.
- The payments API directly: payments are read only through the order's `paymentInfo` expansion.
- Messages queries: order events arrive only through the subscription.
