# Knowledge Base Index — commercetools Stripe Tax Connector

**What this connector covers:** Real-time sales tax calculation via Stripe Tax for commercetools carts, plus async order sync to Stripe Tax transactions for reporting.

**What this connector does NOT cover:** payment processing, refunds or transaction reversals, Stripe webhooks, EU VAT number validation, tax registration or compliance advice, OSS reporting, manual rate overrides, renewal tax, carts outside `ExternalAmount` mode, and excluded-territory handling. The full list is `adopter-guide.md` §2, "What this connector does not do"; the short form is `feature-scope.md` → Out of Scope.

**One context for both modules.** `tax-calculator` and `order-syncer` ship in one manifest, are never adopted apart, and are coupled by a data contract on commercetools custom fields (`tax-calculator` writes `connectorStripeTax_calculationReferences`, `order-syncer` reads it) rather than by any import or HTTP call.

---

## Route by Question Type

### "Can I / Is it possible to...?"

| Question | Document |
| --- | --- |
| Does this connector support tax calculation in territory X? | `business-rules/unsupported-territories.md` |
| Can I calculate taxes for multiple shipping addresses? | `business-rules/calculation-requests.md` (Multiple mode, ship-from groups) |
| Can I configure ship-from addresses? | `business-rules/ship-from.md` |
| Can I map product categories to Stripe Tax codes? | `business-rules/tax-code-resolution.md` |
| Does this connector support inclusive tax? | `business-rules/tax-behavior.md` |
| What features does this connector support? | `feature-scope.md` |
| How do I install and configure it? | `adopter-guide.md` |
| How does another application call it? | `host-integration.md` |

### "How does X work?"

| Question | Document |
| --- | --- |
| How does tax calculation work end to end? | `ARCHITECTURE.md` + `workflows/process-tax-orchestration.md` |
| How is the tax destination chosen? | `business-rules/tax-destination.md` |
| How is inclusive/exclusive decided? | `business-rules/tax-behavior.md`; `workflows/process-tax-behavior-determination.md` |
| How is the ship-from address resolved? | `business-rules/ship-from.md`; `workflows/process-ship-from-selection.md` |
| How are Stripe Tax codes resolved from CT categories? | `business-rules/tax-code-resolution.md`; `workflows/process-category-retrieval.md`, `workflows/process-category-taxcode-selection.md`, `workflows/process-shipping-taxcode-selection.md` |
| What is sent to Stripe for a cart? | `business-rules/calculation-requests.md` |
| How do Stripe's results become cart update actions? | `business-rules/calculation-results.md`; `workflows/process-update-action-creation.md` |
| What happens to a cart after payment is attached? | `workflows/process-stored-calculation-reapply.md`; `business-rules/tax-calculation.md` Rule 8 |
| How are completed orders synced to Stripe Tax? | `business-rules/order-sync.md`; `workflows/process-order-tax-transaction-sync.md` |
| What is the contract between the two modules? | `business-rules/calculation-reference-contract.md` |
| How does the CT API Extension trigger work? | `business-rules/tax-calculation.md` Rule 2 |
| How does the connector handle large catalogs? | `business-rules/tax-code-resolution.md` Rule 3, *Category data is cached for 5 minutes* |
| What does deploy and undeploy change in my project? | `business-rules/deploy-lifecycle.md`; `workflows/process-deploy-and-undeploy.md` |
| How does the address check work? | `business-rules/address-validation.md`; `workflows/process-address-validation.md` |

### "What happens when X fails?"

| Question | Document |
| --- | --- |
| What happens when Stripe Tax calculation fails? | `business-rules/error-responses.md` |
| What does the connector answer for each error? | `business-rules/error-responses.md` |
| What happens when order sync to Stripe Tax fails? | `business-rules/order-sync.md` Rule 5 |
| What happens when the API Extension times out? | `business-rules/tax-calculation.md` Rule 1 |
| What happens for an excluded territory? | `business-rules/unsupported-territories.md` |
| How do I troubleshoot a symptom? | `adopter-guide.md` |

### "What are the rules for X?"

| Question | Document |
| --- | --- |
| Rules for the extension, re-apply and update actions | `business-rules/tax-calculation.md` |
| Rules for building Stripe requests | `business-rules/calculation-requests.md` |
| Rules for turning results into actions | `business-rules/calculation-results.md` |
| Rules for the tax destination | `business-rules/tax-destination.md` |
| Rules for tax behavior | `business-rules/tax-behavior.md` |
| Rules for ship-from resolution | `business-rules/ship-from.md` |
| Rules for tax code resolution | `business-rules/tax-code-resolution.md` |
| Rules for error responses | `business-rules/error-responses.md` |
| Rules for order sync | `business-rules/order-sync.md` |
| Rules for the cross-module contract | `business-rules/calculation-reference-contract.md` |
| Rules for the address check | `business-rules/address-validation.md` |
| Rules for deploy and undeploy | `business-rules/deploy-lifecycle.md` |
| Excluded territories | `business-rules/unsupported-territories.md` |

---

## Every document

### Generated from the code

| File | What it holds |
| --- | --- |
| `ARCHITECTURE.md` | Both modules, the trigger condition, custom types, update actions, configuration, out of scope |
| `feature-scope.md` | Supported, partial and unsupported features, area by area |
| `index.md` | This router |

### Guides

| File | What it holds |
| --- | --- |
| `adopter-guide.md` | Prerequisites, installation, configuration, verification checklist, troubleshooting |
| `host-integration.md` | How another application calls the connector |
| `reference/stripe-tax-api.md` | The Stripe Tax calls used and the constraints that affect this unit |
| `reference/commercetools-sdk.md` | The commercetools SDK calls used and their constraints |

### Business rules

| File | Scope |
| --- | --- |
| `business-rules/tax-calculation.md` | Timeout, trigger, action order, partial failure, references, shipping behavior, re-apply |
| `business-rules/calculation-requests.md` | What each Stripe request contains, per shipping mode |
| `business-rules/calculation-results.md` | Net, gross, rates and shipping actions derived from results |
| `business-rules/tax-destination.md` | The delivery address as the only destination |
| `business-rules/tax-behavior.md` | Inclusive/exclusive resolution |
| `business-rules/ship-from.md` | Origin resolution and the required mode |
| `business-rules/tax-code-resolution.md` | Category and shipping tax codes, the cache, the mapping JSON |
| `business-rules/error-responses.md` | What the extension answers for each error |
| `business-rules/order-sync.md` | Transactions, statuses, redelivery |
| `business-rules/calculation-reference-contract.md` | The field contract between the modules |
| `business-rules/address-validation.md` | The address check endpoint |
| `business-rules/deploy-lifecycle.md` | Post-deploy and pre-undeploy |
| `business-rules/unsupported-territories.md` | Excluded territories |

### Workflows

| File | Flow |
| --- | --- |
| `workflows/process-tax-orchestration.md` | A cart calculation, end to end |
| `workflows/process-tax-behavior-determination.md` | Inclusive/exclusive for the cart's destination |
| `workflows/process-category-retrieval.md` | Fetching and caching product categories |
| `workflows/process-category-taxcode-selection.md` | A line item's tax code |
| `workflows/process-shipping-taxcode-selection.md` | The shipping tax code |
| `workflows/process-ship-from-selection.md` | Each line item's origin |
| `workflows/process-update-action-creation.md` | Building the cart update actions |
| `workflows/process-stored-calculation-reapply.md` | Re-applying a stored calculation after payment |
| `workflows/process-address-validation.md` | The address check endpoint |
| `workflows/process-order-tax-transaction-sync.md` | Order sync to Stripe Tax transactions |
| `workflows/process-deploy-and-undeploy.md` | Post-deploy and pre-undeploy of both modules |
| `workflows/postman-test-cases.json` | Test cases (cart request bodies) for exercising `tax-calculator` from Postman |

---

## Reading Order by Role

### Adopting this connector (installing for the first time)

1. `adopter-guide.md` — prerequisites, category tax code setup, deploy steps, env vars, verification

### New to this connector (developer onboarding)

1. `ARCHITECTURE.md` — system overview, two-component architecture (tax-calculator + order-syncer)
2. `feature-scope.md` — what's supported and what's not
3. `business-rules/tax-calculation.md` — the core rules, especially the 2-second timeout constraint

### Implementing a tax feature
1. Read the repository's `CLAUDE.md` first
2. Read `business-rules/tax-calculation.md` — all rules apply to any tax-related change
3. Read the specific `business-rules/` file for the domain (destination, behavior, requests, results, ship-from, tax codes, etc.)
4. Check `feature-scope.md` to confirm the feature is in scope

### Debugging a tax calculation issue
1. `business-rules/tax-calculation.md` Rule 2 — check extension trigger conditions
2. `business-rules/tax-calculation.md` Rule 3 — check update action ordering
3. `business-rules/error-responses.md` — what each status and body means
4. `business-rules/unsupported-territories.md` — if issue is territory-specific

### Debugging an order sync issue
1. `business-rules/order-sync.md` Rule 5 — which outcomes are acknowledged and which are redelivered
2. `workflows/process-order-tax-transaction-sync.md` — the path and its error table
