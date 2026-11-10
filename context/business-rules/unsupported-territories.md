# Unsupported Territories — Stripe Tax

## Overview

Stripe Tax does not calculate tax for certain excluded territories, even when the shipping address country is one where Stripe Tax is generally supported. These territories fall outside the tax jurisdiction of their parent country for VAT/sales tax purposes.

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

---

## Out of Scope

- Tax calculation accuracy for territories where Stripe Tax *does* operate — that is Stripe's responsibility
- Tax registration or compliance obligations in excluded territories — outside the connector's scope
