# commercetools SDK — Reference

> What the `ct-stripe-tax` connector uses from this SDK. Not a complete reference.

## SDK version

`@commercetools/sdk-client-v2` (per `CLAUDE.md` Stack) — used by both `tax-calculator` and `order-syncer` independently (no shared client code between them, see `context/ARCHITECTURE.md` → Cross-Module Coupling).

## What this connector uses

| Concept / Class | How this connector uses it |
| --- | --- |
| API Extensions | `tax-calculator` registers a synchronous cart Extension at post-deploy (`timeoutInMs: 2000`) — see `business-rules/tax-calculation.md` Rule 2 for the exact trigger condition |
| Pub/Sub Subscriptions | `order-syncer` registers a subscription on `OrderCreated` at post-deploy |
| Custom Types | Both modules create/read custom types on `cart`/`order`, `product-price`/`line-item`, `category`, and `shipping-method` resources — see `context/ARCHITECTURE.md` → CT Custom Types Created by the Connector |
| `productProjections` | `tax-calculator` fetches product/category data for tax code resolution, cached 5 minutes |
| `channels`, `inventory` | `tax-calculator`'s ship-from resolution strategies |

## Key API calls used

| Method | What it does | Where called in this connector |
| --- | --- | --- |
| `extensions().post()` / `.get()` / `.delete()` | Create/verify/remove the API Extension | `tax-calculator/src/connectors/action.js:37-56,97-121` |
| `subscriptions().post()` / `.get()` / `.delete()` | Create/verify/remove the Pub/Sub subscription | `order-syncer/src/connectors/action.js:14-82` |
| `types().post()` / `.get()` / `.delete()` | Create/verify/remove custom types (both modules) | `tax-calculator/src/connectors/action.js:290-332`; `order-syncer/src/connectors/action.js:90-251` |
| `orders().get()` / `.post()` | Read order + `paymentInfo`; write `connectorStripeTax_transactionReferences` via `setCustomField` | `order-syncer/src/clients/{query,update}.client.js` |
| `productProjections().get()` | Fetch product/category data for tax code resolution | `tax-calculator/src/services/category.service.js:145` |

## Constraints relevant to this connector

- **This connector uses `CTP_REGION`**, not the `CTP_AUTH_URL`/`CTP_API_URL` pair the payment connectors (`ct-connect-stripe-checkout`, `ct-connect-stripe-composable`) use — see `../../context/known-issues.md`-adjacent naming inconsistency noted in the Integration-level docs.
- **The API Extension has a hard 2000ms timeout** enforced by commercetools, not configurable by this connector (`business-rules/tax-calculation.md` Rule 1) — all tax calculation logic (category fetch, ship-from resolution, Stripe calls) must complete within that window.
- **Pub/Sub push delivery has no built-in application-layer authentication** in this connector's code — protection must come from infrastructure (private ingress, GCP push subscription identity), see `order-syncer/context/ARCHITECTURE.md`.
