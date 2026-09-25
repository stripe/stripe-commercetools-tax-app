# Unsupported Territories — Stripe Tax

## Overview

Stripe Tax does not calculate tax for certain excluded territories, even when the shipping address country is one where Stripe Tax is generally supported. These territories fall outside the tax jurisdiction of their parent country for VAT/sales tax purposes.

**Current connector behavior:** The connector passes requests for excluded territories to Stripe Tax as-is. Stripe Tax may return 0% tax, an error, or incomplete results depending on the territory. There is no territory detection or fallback logic implemented.

---

## Excluded Territories by Country

| Parent Country | Excluded Territories |
|---|---|
| Denmark | Faroe Islands, Greenland |
| Finland | Åland Islands |
| France | French Guyana, French Polynesia, Guadeloupe, Martinique, Mayotte, New Caledonia, Réunion, Saint Barthélemy, Saint Martin, Saint Pierre and Miquelon, Wallis and Futuna |
| Italy | Vatican City |
| Monaco | Monaco (Stripe Tax not supported at all) |
| Netherlands | Bonaire, Curaçao, Saba, Sint Eustatius, Sint Maarten |
| Norway | Jan Mayen, Svalbard |
| Portugal | Azores, Madeira |
| Spain | Canary Islands, Ceuta, Melilla |
| United Kingdom | British Virgin Islands, Channel Islands, Falkland Islands, Gibraltar, Isle of Man |

**Detection note:** Some territories share the parent country's ISO code (e.g., Spain `ES`) and are only distinguishable by region code or postal code prefix:
- Canary Islands: postal codes `35xxx`, `38xxx`
- Ceuta: `51xxx`
- Melilla: `52xxx`

---

## What Is Not Implemented

- No detection of excluded territories before calling Stripe Tax
- No fallback tax calculation for excluded territories
- No configuration option to choose a handling strategy (zero tax, manual rates, error)
- No specific error message surfaced to CT when an excluded territory is detected

**What breaks:** For merchants with customers in excluded territories, Stripe Tax may return unexpected results (0% tax, API error, or a response treating the address as the parent country). The CT cart update action may contain incorrect or missing tax data for these orders.

---

## Handling Options (Not Yet Chosen)

When this is implemented, the connector must choose one strategy and document it as an ADR:

| Strategy | Behavior | When to use |
|---|---|---|
| Zero tax | Return 0% tax for excluded territories | Merchant operates in jurisdictions where 0% is correct (e.g., Faroe Islands) |
| Manual rate mapping | Apply preconfigured rates per territory | Merchant has known tax obligations in specific territories (e.g., Canary Islands IGIC 7%) |
| External service | Delegate to an alternative tax engine | Merchant requires accurate calculation for all territories |
| Error / block | Reject the cart update | Merchant explicitly does not ship to excluded territories |

The strategy must be configured per deployment — there is no single correct answer across all merchants.

---

## Out of Scope

- Tax calculation accuracy for territories where Stripe Tax *does* operate — that is Stripe's responsibility
- Tax registration or compliance obligations in excluded territories — outside the connector's scope
- Automatic detection of which strategy is correct for a given merchant
