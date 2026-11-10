# Deploy Lifecycle

What each module's post-deploy and pre-undeploy scripts create, change and remove on the
platform, and in what order. Both scripts run under `connect.yaml` → `scripts`.

## Rule 1: `tax-calculator` refuses to deploy unless provider tax is active with a head office

**What:** Before any platform change, `tax-calculator`'s post-deploy retrieves the provider's tax
settings. Deploy fails (exit 1) when any of the following holds:
- settings are absent;
- status is `'pending'` (the missing fields are listed);
- status is anything other than `'active'`;
- `head_office` is missing.

Before that check, deploy fails if `STRIPE_API_TOKEN` or `CONNECT_SERVICE_URL` is falsy.

**Invariant:**
- The token and URL guards are at `tax-calculator/src/connectors/post-deploy.js:27`, `:31`.
- `await validateStripeTax(stripeApiToken)` runs at `:37`, before `createApiRoot()` at `:42`.
- The status checks are at `tax-calculator/src/validators/stripeTaxValidator.js:48`, `:55`, `:61`.

**Implementation:** `tax-calculator/src/validators/stripeTaxValidator.js:14-66`

---

## Rule 2: Each category in the mapping must exist at deploy — by id **or** key

**What:** When `TAX_CODE_CATEGORY_MAPPING_JSON` is truthy, it is parsed and each entry is checked:
- `ctCategory` must be an object with an `id` or a `key`;
- a category matching `id="…" or key="…"` must exist.

**Branches:**
- **Invalid JSON** → deploy fails.
- **An empty `categories` list, or an unset or empty variable** → validation is skipped.
- **Both `id` and `key` given** → the predicate is OR; it passes if **either** matches.

**Why:** It catches a mapping that names categories which do not exist, at install time.

**Invariant:**
- `whereClauses.join(' or ')` (`tax-calculator/src/connectors/action.js:165`).
- The existence check `if (!categories || categories.length === 0)` throws (`:211-217`).
- The empty-mapping skip is `if (!mapping || !mapping.categories || mapping.categories.length === 0) return` (`:241-244`).

**Implementation:** `tax-calculator/src/connectors/action.js:131-261`

---

## Rule 3: Post-deploy adds connector fields to every existing type of the same resource, not only its own

**What:** For each connector custom type, both modules list **every** platform type whose
`resourceTypeIds` contains the definition's **first** resource type. They then add whichever
connector field definitions that type lacks. The connector's own type is created only if no
listed type has its key.

**Branches:**
- **Merchant-owned** types on `product-price`, `category`, `shipping-method` and `order` gain the
  connector fields.
- **The product type** is searched by `product-price` only (its first resource type,
  `tax-calculator/src/connectors/customTypes.js:37`).

**Invariant:**
- The lookup is `getCustomTypesByResourceTypeId(apiRoot, customType.resourceTypeIds[0])`: in
  `tax-calculator/src/connectors/action.js:292` and in `order-syncer/src/connectors/action.js:109`.
- The per-type `addFieldDefinition` loop is at `tax-calculator/src/connectors/action.js:295-321`
  and `order-syncer/src/connectors/action.js:112-138`.

**Implementation:** the two `addOrUpdateCustomType` functions above

---

## Rule 4: `tax-calculator` replaces its API extension by deleting it first

**What:** If an extension with key `ctpTaxCalculatorExtension` exists, post-deploy deletes it, then
creates the new one. The extension is the last step of post-deploy.

**Invariant:** `.delete(...)` at `tax-calculator/src/connectors/action.js:46` precedes
`apiRoot.extensions().post(...)` at `:56` inside the same `try`.

**Implementation:** `tax-calculator/src/connectors/action.js:11-67`; called last at
`tax-calculator/src/connectors/post-deploy.js:66-70`

---

## Rule 5: `order-syncer` replaces its subscription by deleting it first, then subscribes to `OrderCreated` only

**What:**
- Post-deploy deletes the subscription keyed `ct-connect-tax-integration-order-change-subscription`
  if present.
- It then creates it with destination `GoogleCloudPubSub`. The topic and project come from
  `CONNECT_GCP_TOPIC_NAME` / `CONNECT_GCP_PROJECT_ID`. `order-syncer` is an `applicationType: event`
  (`connect.yaml`).
- It subscribes to `resourceTypeId: 'order'`, `types: ['OrderCreated']`.

**Invariant:**
- The delete is at `order-syncer/src/connectors/action.js:20`, before the post at `:22-40`.
- The message filter is `resourceTypeId: 'order'` (`:34`), `types: MESSAGE_TYPE` (`:35`), with
  `MESSAGE_TYPE = ['OrderCreated']` (`order-syncer/src/constants/connectors.constants.js:1`).

**Implementation:** `order-syncer/src/connectors/action.js:14-43`

---

## Rule 6: Pre-undeploy removes connector fields from every matching type and deletes single-field types

**What:** Both modules' pre-undeploy scripts first remove their platform hook: the extension in
`tax-calculator`, the subscription in `order-syncer`. Then, for every type of the definition's
first resource type that has a connector field, they remove the connector field definitions the
type has.
- **The type has exactly one field definition** → the **whole type** is deleted.
- **Otherwise** → only the connector fields are removed.

**Invariant:**
- The whole-type delete happens `if (type.fieldDefinitions?.length === 1)`: at
  `tax-calculator/src/connectors/action.js:412` and `order-syncer/src/connectors/action.js:227`.

**Implementation:** the two `deleteCustomTypes` / `deleteOrUpdateCustomType` pairs above
