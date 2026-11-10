# Address Validation

`POST /taxCalculator/validateAddress` checks whether the tax provider can tax an address. No
caller is configured by this connector; it is an endpoint offered to whoever integrates it.

## Rule 1: Local requirements are per country — US is strict, everyone else needs little more than a country

**What:** After an ISO 3166-1 alpha-2 country check, the requirements depend on the country:

| Country | Required | Format checks |
| --- | --- | --- |
| `US` | `line1`, `city`, `state`, `postal_code`, `country` | ZIP or ZIP+4; state in a list of 50 codes |
| `CA` | `country` only | postal code pattern and province list, applied **only when present** |
| `IN` | `country`, plus one of `postal_code` / `state` | 6-digit postal code |
| any other | `country` only | none beyond the length checks below |

Two length checks apply to every country, not only the table's rows: `line1` must be 1–200
characters and `city` 1–100 characters, each **when present**
(`tax-calculator/src/validators/address.validator.js:181-202`).

**Implementation:** `tax-calculator/src/validators/address.validator.js:151-205`

---

## Rule 2: Only a locally valid address is sent to the provider, as a real 100-unit calculation

**What:** If local validation passes, the service creates a provider tax calculation with:
- `amount: 100`;
- `tax_code: 'txcd_99999999'`;
- `reference: 'address-verification'`;
- the currency of the country, or `ADDRESS_VALIDATION_STRIPE_DEFAULT_CURRENCY`, or `'usd'`.

The address is accepted when the call succeeds. If local validation fails, no provider call is
made.

**Why:** The provider is the authority on whether it can tax an address; local rules first avoid
a provider call for addresses that are obviously incomplete.

**Implementation:** `tax-calculator/src/services/address.service.js:135-178`

---

## Rule 4: The address endpoint uses its own provider client, created at import

**What:** The address service builds its own provider client from `process.env.STRIPE_API_TOKEN`
when the module loads.

**Implementation:** `tax-calculator/src/services/address.service.js:5`
