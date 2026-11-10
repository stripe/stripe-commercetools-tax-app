# Process Deploy and Undeploy

**Trigger:** commercetools Connect runs each application's `postDeploy` script on deploy and its `preUndeploy`
script on undeploy (`connect.yaml:6-7`, `connect.yaml:59-60`).
**Modules involved:** tax-calculator, order-syncer — each with its own `connectors/post-deploy.js`,
`connectors/pre-undeploy.js`, `connectors/action.js` and `connectors/customTypes.js`. Rules:
`business-rules/deploy-lifecycle.md` Rules 1–6.
**Outcome:**
- **Deploy** → the API extension `ctpTaxCalculatorExtension`, four connector custom types (whose fields are also
  added to every existing type of the same resource), and the `OrderCreated` subscription.
- **Undeploy** → all of those removed, including the connector fields on the merchant's own types.

## Happy Path — tax-calculator post-deploy

1. `STRIPE_API_TOKEN` and `CONNECT_SERVICE_URL` must be present — `tax-calculator/src/connectors/post-deploy.js:27-33`
2. Stripe Tax settings must be `active` and have a head office; the account's default `tax_behavior` and
   `tax_code` are copied into this process's environment when unset —
   `tax-calculator/src/connectors/post-deploy.js:37`; `tax-calculator/src/validators/stripeTaxValidator.js:14-83`
3. If `TAX_CODE_CATEGORY_MAPPING_JSON` is set, it is parsed and each `categories[].ctCategory` (by `id` **or**
   `key`) must exist; an empty or absent mapping is accepted —
   `tax-calculator/src/connectors/post-deploy.js:45-60`; `tax-calculator/src/connectors/action.js:131-261`
4. For each of the four custom types (product, category, shipping method, cart/order): add its missing field
   definitions to **every** existing type of the same resource type, then create the type if its key is absent —
   `tax-calculator/src/connectors/post-deploy.js:63`; `tax-calculator/src/connectors/action.js:269-332`
5. Delete the existing extension, if any, then create it with the trigger condition and `timeoutInMs: 2000` —
   `tax-calculator/src/connectors/post-deploy.js:66-70`; `tax-calculator/src/connectors/action.js:11-67`

## Happy Path — order-syncer post-deploy

1. Read `CONNECT_GCP_TOPIC_NAME` and `CONNECT_GCP_PROJECT_ID` —
   `order-syncer/src/connectors/post-deploy.js:16-17`
2. Delete the existing subscription, if any, then create it for `order` / `OrderCreated` on the Pub/Sub topic —
   `order-syncer/src/connectors/post-deploy.js:20-25`; `order-syncer/src/connectors/action.js:14-43`
3. Add `connectorStripeTax_transactionReferences` to every `order` type, and create the type if its key is
   absent — `order-syncer/src/connectors/post-deploy.js:26`; `order-syncer/src/connectors/action.js:90-149`

## Happy Path — pre-undeploy (both modules)

1. Remove the platform hook:
   - the extension — `tax-calculator/src/connectors/pre-undeploy.js:16`
   - the subscription — `order-syncer/src/connectors/pre-undeploy.js:15`
2. For every type of the same resource type that carries connector fields: delete the type if it has exactly
   one field definition, otherwise remove the connector fields —
   `tax-calculator/src/connectors/pre-undeploy.js:19`, `tax-calculator/src/connectors/action.js:367-436`;
   `order-syncer/src/connectors/pre-undeploy.js:18`, `order-syncer/src/connectors/action.js:184-251`

## Error Paths

| Condition | Behavior | File |
| --- | --- | --- |
| Token or URL missing; Stripe Tax not active or no head office; mapping not valid JSON; a mapped category missing; a custom-type step fails | exit code 1 | `tax-calculator/src/connectors/post-deploy.js:77-85` |
| Extension create fails | exit code 1 | `tax-calculator/src/connectors/action.js:43-66` |
| Subscription create fails (e.g. topic or project unset) | exit code 1 | `order-syncer/src/connectors/action.js:20-40`; `order-syncer/src/connectors/post-deploy.js:37-40` |
| order-syncer custom-type step fails | exit code 1 | `order-syncer/src/connectors/action.js:93-99` |
| Hook removal fails during undeploy | exit code 1 | `tax-calculator/src/connectors/pre-undeploy.js:27-33`; `order-syncer/src/connectors/pre-undeploy.js:25-32` |

## Notes

- Both modules use the custom-type key `connector-stripe-tax-calculation-reference` by default. The two keys are
  separate settings, `CUSTOM_TYPE_CART_KEY` and `CUSTOM_TYPE_ORDER_KEY` (`connect.yaml:22`, `:63`).
