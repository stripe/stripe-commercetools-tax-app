# Calculation Reference Contract

The contract between the two modules. **No code is shared and nothing is imported.** The modules
are coupled only through platform custom fields with the same names, on a custom type with the
same default key. What `tax-calculator` writes is `tax-calculation.md` Rule 5, *Calculation references must be written via setCustomType in the same response*; what `order-syncer`
does with it is `order-sync.md`.

## Rule 1: `order-syncer` reads the references that `tax-calculator` writes, under a field name each module declares on its own

**What:**
- `tax-calculator` writes the provider calculation ids to the cart field
  `connectorStripeTax_calculationReferences`.
- `order-syncer` reads that field from the order.
- The name is a string literal declared independently in each module.

**Why:** The two apps deploy separately and share only the platform's data.
**Invariant:**
- Producer name: `tax-calculator/src/connectors/customTypes.js:12`. Producer write:
  `tax-calculator/src/services/update-action.service.js:207`.
- Consumer name: `order-syncer/src/connectors/customTypes.js:10`. Consumer read:
  `order-syncer/src/controllers/sync.controller.js:85`.

**Implementation:** the four sites above

---

## Rule 2: The reference field's definition exists only because `tax-calculator`'s post-deploy created it

**What:**
- `order-syncer`'s own custom type defines **only** `connectorStripeTax_transactionReferences`.
- The calculation-references field is defined by `tax-calculator`'s cart type, whose
  `resourceTypeIds: ["order"]` covers both carts and orders.

**Why:** The two modules are deployed together by one manifest (`connect.yaml`), so the producer's type is normally present.
**Invariant:**
- `order-syncer/src/connectors/customTypes.js:24-37` is the only `fieldDefinitions` entry of
  `ORDER_TAX_CUSTOM_TYPE`.
- The producer's definition starts at `tax-calculator/src/connectors/customTypes.js:124` and is
  created by `createCustomTypes` (`tax-calculator/src/connectors/post-deploy.js:63`).

**Implementation:** `tax-calculator/src/connectors/customTypes.js:113-136`

---

## Rule 3: The cart-to-order copy of the references is platform behaviour, not code

**What:** `tax-calculator` writes the references on the **cart**, and `order-syncer` reads them
from the **order**. Neither module copies them. Their presence on the order depends on the
platform carrying the cart's custom type and fields into the order it creates.
**Invariant:** no code in either module writes `connectorStripeTax_calculationReferences` to an
order. The only write is the cart `setCustomType` returned by the extension
(`tax-calculator/src/services/update-action.service.js:201`).
**Implementation:** none — an absence

---

## Rule 4: The two modules' type keys are separate settings with the same default

**What:** The custom type key is set per module: `CUSTOM_TYPE_CART_KEY` in `tax-calculator`,
`CUSTOM_TYPE_ORDER_KEY` in `order-syncer`. Both default to
`connector-stripe-tax-calculation-reference`.
- **Keys equal** → one shared type carries both modules' fields.
- **Keys differ** →
  - `order-syncer` creates a **second** type holding only the transaction-references field;
  - it still adds that field to **every** existing `order` type, the calculator's included
    (`deploy-lifecycle.md` Rule 3, *Post-deploy adds connector fields to every existing type of the same resource, not only its own*);
  - orders keep the calculator's type, so the sync keeps working, and the second type is unused.

**Invariant:**
- `process.env.CUSTOM_TYPE_CART_KEY || "connector-stripe-tax-calculation-reference"`
  (`tax-calculator/src/connectors/customTypes.js:114`).
- `process.env.CUSTOM_TYPE_ORDER_KEY || "connector-stripe-tax-calculation-reference"`
  (`order-syncer/src/connectors/customTypes.js:15`).

**Implementation:** `connect.yaml:22-25`, `connect.yaml:63-66`

---

## Rule 5: The transaction references are written by `order-syncer` and read by no module

**What:** `order-syncer` writes `connectorStripeTax_transactionReferences` on the order. No module
of this connector reads it back.
**Why:** It records, for whoever inspects the order, which provider transactions were committed
(`order-sync.md` Rule 3, *Transaction references are stored on the order, plus PaymentIntent metadata*).
**Invariant:** the only write is the `setCustomField` at `order-syncer/src/clients/update.client.js:14-18`.
**Implementation:** `order-syncer/src/clients/update.client.js:13-36`

---

## Rule 6: `order-syncer` binds each reference with metadata `tax-calculator` stamps, and with copies of its destination and jurisdiction key

**What:** Before filing, `order-syncer` retrieves each referenced calculation and reads what
`tax-calculator` wrote into it (`order-sync.md` Rule 11, *A reference is filed only when the
calculation it names belongs to this order*):
- `metadata.cartId` on **every** line item — must equal `order.cart.id`;
- `metadata.shippingKey` on the line items, in Multiple mode — names the shipment whose address the
  calculation was made for;
- `customer_details.address` — compared with the destination `tax-calculator` would have sent, rebuilt
  from the order by copies of `tax-calculator`'s `extractCustomerAddress` and `createAddressKey`.

**Why:** These stamps are written by the connector when the calculation is made and cannot be
written by the shopper.
**Invariant:** `tax-calculator` stamps `cartId` and `shippingKey` on every line item it sends
(`tax-calculator/src/services/tax-orchestrator.service.js` → `createSingleRequestForGroup`,
`buildLineItemForShippingMethod`); `order-syncer`'s `jurisdictionKey` and
`orderDestinationForCalculation` give the same results as `createAddressKey` and
`extractCustomerAddress` on the parity fixture each module vendors
(`<module>/test-fixtures/jurisdiction-parity.json`, the two copies pinned identical by a shared
SHA-256 both suites assert); and the stamp names are the ones in that fixture's `stamps` section
(`cart`: `cartId`, `shipping`: `shippingKey`).
**Implementation:** `order-syncer/src/validators/calculation-binding.validators.js`; parity tests
`order-syncer/test/unit/validators/jurisdiction-parity.spec.js` (the binding accepts a calculation
stamped with the fixture's names) and `tax-calculator/test/unit/services/jurisdiction-parity.spec.js`
(`buildLineItemForShippingMethod` and `createSingleRequestForGroup` write the fixture's names).
