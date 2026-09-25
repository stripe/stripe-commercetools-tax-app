# Knowledge Base Index — ct-stripe-tax

**What this connector covers:** Real-time sales tax calculation via Stripe Tax for commercetools carts, plus async order sync to Stripe Tax transactions for reporting.

**What this connector does NOT cover:** Tax calculation for excluded territories (not implemented), EU VAT number validation, tax registration or compliance advice. See `feature-scope.md → Out of Scope` for the full list.

For questions about the Integration as a whole (failure modes, shared payment rules), see `../../context/index.md`.

**One Connector Unit, not split (per ADR-003, corrected 2026-07-28):** `order-syncer` and `tax-calculator` share this one `context/` — same treatment as an enabler+processor pair. Although each passes T2 of the 3-Test Rule (independently operable in code) and there's no direct import or HTTP call between them, they communicate through a real producer→consumer data contract via CT custom fields (`tax-calculator` writes `connectorStripeTax_calculationReferences`, `order-syncer` reads it) — a coupling the hub's original T3 wording (URL env var only) didn't account for. See `../../context/decisions/003-context-role-classification.md` addendum.

---

## Route by Question Type

### "Can I / Is it possible to...?"

| Question | Document |
| --- | --- |
| Does this connector support tax calculation in territory X? | `business-rules/unsupported-territories.md` |
| Can I calculate taxes for multiple shipping addresses? | `business-rules/tax-calculation.md` (multiple ship-from groups) |
| Can I configure ship-from addresses? | `business-rules/ship-from.md` |
| Can I map product categories to Stripe Tax codes? | `business-rules/tax-code-resolution.md` |
| Does this connector support inclusive tax? | `business-rules/tax-calculation.md` |
| What features does this connector support? | `feature-scope.md` |

### "How does X work?"

| Question | Document |
| --- | --- |
| How does tax calculation work end to end? | `ARCHITECTURE.md` + `business-rules/tax-calculation.md` |
| How is the ship-from address resolved? | `business-rules/ship-from.md` |
| How are Stripe Tax codes resolved from CT categories? | `business-rules/tax-code-resolution.md` |
| How are completed orders synced to Stripe Tax? | `business-rules/order-sync.md` |
| How does the CT API Extension trigger work? | `business-rules/tax-calculation.md` Rule 2 |
| How does the connector handle large catalogs? | `business-rules/tax-calculation.md` (batch processing) |

### "What happens when X fails?"

| Question | Document |
| --- | --- |
| What happens when Stripe Tax calculation fails? | `failure-modes.md` |
| What happens when order sync to Stripe Tax fails? | `failure-modes.md` |
| What happens when Stripe or CT is down in general? | `../../context/failure-modes.md` |
| What happens when the API Extension times out? | `business-rules/tax-calculation.md` Rule 1 |
| What happens for an excluded territory? | `business-rules/unsupported-territories.md` |
| What are the known technical gotchas? | `known-issues.md` — 25 issues covering both modules |

### "What are the rules for X?"

| Question | Document |
| --- | --- |
| Rules for tax calculation | `business-rules/tax-calculation.md` |
| Rules for ship-from resolution | `business-rules/ship-from.md` |
| Rules for tax code resolution | `business-rules/tax-code-resolution.md` |
| Rules for order sync | `business-rules/order-sync.md` |
| Excluded territories | `business-rules/unsupported-territories.md` |
| Why was architectural decision X made? | `decisions/` |

---

## Reading Order by Role

### Adopting this connector (installing for the first time)

1. `adopter-guide.md` — prerequisites, category tax code setup, deploy steps, env vars, verification

### New to this connector (developer onboarding)

1. `ARCHITECTURE.md` — system overview, two-component architecture (tax-calculator + order-syncer)
2. `feature-scope.md` — what's supported and what's not
3. `business-rules/tax-calculation.md` — the core rules, especially the 2-second timeout constraint
4. `known-issues.md` — gotchas specific to this connector

### Implementing a tax feature
1. Read hub `CLAUDE.md` + `../../context/known-issues.md` first
2. Read `business-rules/tax-calculation.md` — all rules apply to any tax-related change
3. Read the specific `business-rules/` file for the domain (ship-from, tax codes, etc.)
4. Check `feature-scope.md` to confirm the feature is in scope

### Debugging a tax calculation issue
1. `business-rules/tax-calculation.md` Rule 2 — check extension trigger conditions
2. `business-rules/tax-calculation.md` Rule 3 — check update action ordering
3. `business-rules/unsupported-territories.md` — if issue is territory-specific
4. `known-issues.md` — connector-specific gotchas
