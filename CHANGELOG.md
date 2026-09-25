# Changelog

All notable changes to the commercetools Stripe Tax connector are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases are cut from `main` and tagged `vX.Y`. `dev` is the integration branch — entries land
under **Unreleased** when they merge there, and move under a version heading when `main` is
tagged.

## [Unreleased]

### Added

- Re-apply path for carts whose `taxedPrice` was cleared after a payment was attached.
  commercetools clears the taxed price on certain cart mutations even when `paymentInfo` is
  already set, which previously left such carts permanently untaxed. The extension now re-applies
  the *existing* Stripe Tax calculation by id rather than creating a new one, keeping the
  PaymentIntent, the cart and the order-syncer on the same `calculationId`.
- Tax transaction handling for orders carrying several calculation references, not just one.
- Non-blocking async logger; log output reduced and given structured metadata.

### Changed

- `order-syncer` now creates Stripe Tax transactions through
  `tax.transactions.createFromCalculation` instead of the Tax Association API.
- The rate-limiter middleware was removed from `tax-calculator`, along with
  `ADDRESS_VALIDATION_RATE_LIMIT` and `ADDRESS_VALIDATION_WINDOW_MINUTES`.
- Documentation reorganized into `context/` (architecture, business rules, workflows, decisions),
  and the README set replaced with the fuller revision that had been developed on the legacy
  `tax` branch.

### Security

- **The tax destination now comes from the delivery address, not from `cart.country`.** The
  address sent to Stripe Tax was assembled from two different cart fields: street, city and postal
  code from the delivery address, but the country from `cart.country` — a price-selection field
  that a shopper can set themselves. Since that country selects the tax jurisdiction, a shopper
  could move the sale to another jurisdiction while the goods still went to the original address,
  and the connector wrote the resulting total back to the cart as the payable amount. The same
  field also selected the inclusive/exclusive tax behavior, and in Multiple shipping mode it
  overrode *every* destination — so a cart legitimately delivering to two countries was taxed as
  if both went to one, with no attacker involved.

  Reported as CTT-002; CWE-840, CVSS 6.5 Medium. See
  `context/decisions/adr-007-tax-destination-country.md`.

  **Action required for merchants using `TAX_BEHAVIOR_COUNTRY_MAPPING`:** the mapping is now
  keyed on where an order is **delivered**, not on the cart's price-selection country. If it was
  configured reading it the other way, review it before upgrading.

  A delivery address that names a city, postal code or street without a country is now rejected
  with a commercetools `InvalidInput` error instead of being completed from `cart.country`. A cart
  with no delivery address at all is unaffected and still calculates.

  Calculations now record the destination they were made for
  (`connectorStripeTax_destinationCountry`, added to the cart custom type on redeploy) and are
  only re-applied while that still matches the cart. Calculations stored before this release
  record none and are recalculated on the cart's next update — no migration is required.

### Fixed

- `order-syncer` now reads the Pub/Sub topic and project from `CONNECT_GCP_TOPIC_NAME` and
  `CONNECT_GCP_PROJECT_ID` — the names commercetools Connect actually injects at runtime. It
  previously read `CONNECT_SUBSCRIPTION_TOPIC_NAME` and `CONNECT_SUBSCRIPTION_PROJECT_ID`, which
  Connect never populates, so `properties.get()` returned `undefined` and post-deploy could not
  create the subscription at all. This is a fix, not a migration: the two values are injected by
  Connect rather than declared in `connect.yaml`, so there is no merchant configuration to change.
  Deployments built before 2025-12-04 never had a working order sync.
- Shipping cost now follows the same resolved tax behavior as line items — country mapping, then
  merchant default, then Stripe's own default. It was hardcoded to `exclusive`, so for countries
  configured as `inclusive` the line items and the shipping line disagreed in the cart total.
- Tax calculation is skipped for carts that already carry `paymentInfo` (outside the re-apply
  case above), and the `order-syncer` JSON body limit was raised to 1 MB.
- Address validation failures return HTTP 400 instead of a success status.
- Missing `.js` extension on imports in `decoder.util`, which broke ES module resolution.
- Zero-tax update actions are labelled with the destination the calculation was made for, read
  back from the calculation itself, instead of falling back to `cart.country`. These actions
  always carry an amount of zero, so no amount was ever wrong, but the `taxRate.country` written
  to the cart could name the shopper's price-selection country rather than the delivery
  jurisdiction — the last three places in `update-action.service.js` still reasoning from
  `cart.country` after the destination fix above.

### Security

- High-severity npm audit findings resolved across both modules, including a `qs` override
  (`^6.14.1`).

### Documentation

- ADR-006 records the tax code resolution strategy — no default code, a missing code fails the
  cart update — which had been decided and implemented in October 2025 without being written down.
- `tax-calculator/README.md` no longer advertises a "5-strategy hierarchy" for tax code
  resolution. Only the category-custom-field scan is active; the other three strategies are
  commented out in `tax-code.service.js`.

## [1.2] — 2025-12-01

### Changed

- Integration tests for `order-syncer` reworked onto mocked dependencies.

## [1.1] — 2025-12-01

### Added

- Custom type keys are configurable through environment variables rather than fixed in code.

### Changed

- Environment variable naming standardized and the configuration layer restructured.
- Mocking infrastructure added to the `tax-calculator` integration tests.
- Dependencies updated across both modules.

## [1.0] — 2025-11-27

First tagged release. Two modules:

- **`tax-calculator`** — a commercetools API Extension that calculates tax in real time on cart
  create and update through Stripe Tax, and writes the result back as external tax amounts.
- **`order-syncer`** — a Pub/Sub subscription handler that turns completed orders into Stripe Tax
  transactions for compliance reporting.
