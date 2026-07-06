# Stripe Tax App

Client-owned Stripe Tax connector for commercetools. Deploys two independent CT Connect applications from a single `connect.yaml`: `tax-calculator` (service) and `order-syncer` (event handler). They do not call each other and can be deployed, operated, and read about independently — each has its own `context/` and `CLAUDE.md`.

## Modules

| Module | Type | Trigger | Role |
| --- | --- | --- | --- |
| [`tax-calculator/`](tax-calculator/CLAUDE.md) | service | CT API Extension on cart Create/Update (`taxMode=ExternalAmount`) | Calculates tax via Stripe Tax, returns CT cart update actions |
| [`order-syncer/`](order-syncer/CLAUDE.md) | event-handler | Google Pub/Sub push on CT `OrderCreated` | Commits Stripe tax transactions for completed orders |

## Before Every Task

Read the specific module's `CLAUDE.md` and `context/ARCHITECTURE.md` before working on it — there is no shared context between the two modules, so reading one does not give you knowledge of the other.

## Structure

```text
stripe-commercetools-tax-app/
  connect.yaml            ← single manifest deploying both applications
  tax-calculator/
    CLAUDE.md
    context/               ← module-level knowledge base (independent)
    src/
  order-syncer/
    CLAUDE.md
    context/               ← module-level knowledge base (independent)
    src/
```

## Notes

- This is the **client's** deployment of the Stripe Tax connector. Orium's internal development equivalent (`ct-stripe-tax`) lives elsewhere in this hub and is a separate codebase — see hub memory for why the two tracks exist.
- No Integration-level `context/` was created or modified for this module. `commercetools-stripe-integration/context/` documents Orium's internal connectors only and does not reference this client app.
