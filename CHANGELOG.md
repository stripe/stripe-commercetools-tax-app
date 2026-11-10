# Changelog

All notable changes to the commercetools Stripe Tax connector are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases are cut from `main` and tagged `vX.Y`. `dev` is the integration branch — entries land
under **Unreleased** when they merge there, and move under a version heading when `main` is
tagged.

## [Unreleased]

### Added

- Re-apply path for carts whose `taxedPrice` was cleared after a payment was attached. The
  extension re-applies the *existing* Stripe Tax calculation by id rather than creating a new one,
  keeping the PaymentIntent, the cart and the order-syncer on the same `calculationId`.
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

- **The tax destination now comes from the delivery address, not from `cart.country`.**

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
  `CONNECT_GCP_PROJECT_ID` — the names commercetools Connect actually injects at runtime. This is
  a fix, not a migration: the two values are injected by Connect rather than declared in
  `connect.yaml`, so there is no merchant configuration to change.
- Shipping cost now follows the same resolved tax behavior as line items — country mapping, then
  merchant default, then Stripe's own default.
- Tax calculation is skipped for carts that already carry `paymentInfo` (outside the re-apply
  case above), and the `order-syncer` JSON body limit was raised to 1 MB.
- Address validation failures return HTTP 400 instead of a success status.
- Missing `.js` extension on imports in `decoder.util`, for ES module resolution.
- Zero-tax update actions are labelled with the destination the calculation was made for, read
  back from the calculation itself, instead of falling back to `cart.country`.

### Security

- High-severity npm audit findings resolved across both modules, including a `qs` override
  (`^6.14.1`).

### Documentation

- Documented the tax code resolution strategy — no default code, a missing code fails the cart
  update — which had been decided and implemented in October 2025 without being written down.

## [1.2.1] - 2026-11-09

### Changed

- Documentation and maintenance updates.

### Fixed

- Bump qs to 6.17.1 to resolve a moderate denial-of-service advisory
- Make `commercetools connect validate` pass — vendor the parity fixture per module, bump body-parser
- Order tax sync now retries when provider credentials are rejected, declines malformed calculation references, files duplicate references only once, and logs orders carrying more than 100 references for manual filing.
- Order tax sync now retries after a temporary provider error so the sale is filed on redelivery, binds each calculation in multiple-shipment orders to its own shipment, and falls back to the order's country as the delivery destination when the order carries no delivery address.
- When syncing an order's tax to the provider, each stored calculation reference is verified to belong to that order — matching the order's cart and delivery destination — before it is filed; references that do not match are skipped, and an existing tax transaction is adopted only when it belongs to the order.
- A stored tax calculation is re-applied only when it was produced for the current cart, and destination-mismatch log entries now record country codes only.
- Destination comparison for re-applying a stored calculation now ignores letter case and surrounding whitespace, so cosmetically different addresses no longer force an extra calculation, and the lookup of a stored calculation is time-bounded.
- After payment, a stored tax calculation is recalculated only when the provider reports it missing; a temporary failure retrieving it is reported as an error instead of re-using a stored result.
- After payment, a stored tax calculation is re-applied only when the destination recorded in that calculation matches the cart's destination at country, state, city and postal-code level; any difference triggers a fresh calculation.

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
