# Error Responses (tax-calculator)

What the platform receives from `POST /taxCalculator` when tax cannot be computed. The platform
treats a non-2xx extension response as a refusal of the cart update. (What `order-syncer` answers
the message bus is `order-sync.md` Rule 5, *Order-syncer acks success, skips, filtered messages and platform read/write failures (204/202); only decode failures, multi-reference provider errors, transient binding failures, a rejected API key and unexpected errors are redelivered*.)

## Rule 1: Unclassifiable input refuses the cart update with 400 `InvalidInput`

**What:** Three errors become HTTP 400 with `{ errors: [{ code: 'InvalidInput', ... }] }`:
- the delivery address has no country (`tax-destination.md` Rule 3, *A delivery address that locates the order but names no country rejects the cart*);
- a line item has no tax code (`tax-code-resolution.md` Rule 1, *Tax code is required — missing code fails the cart update*);
- a ship-from address has no country in required mode (`ship-from.md` Rule 3, *`SHIP_FROM_REQUIRED` decides whether an unresolved item gets the default address, not whether it fails*).

All three are raised before any provider call.
**Why:** These are merchant- or shopper-correctable conditions, so the cart update is refused
with a message rather than taxed wrongly.

---

## Rule 2: A fresh calculation whose provider requests all fail answers 500

**What:** On the fresh path, if every provider tax calculation fails, the endpoint answers **500**.

---

## Rule 3: Any other error carrying a `statusCode` is answered with that status

**What:** An unrecognised error with a truthy `statusCode` is sent with that status and the error
object as the body:
- **A platform SDK error** → its own status. For example, a 404 from a shipping-method fetch
  becomes a 404 to the platform.

---

## Rule 4: A request without a cart is refused with 400

**What:** `_.isEmpty(request.body?.resource?.obj)` → 400 with a serialised `CustomError`. The
response is not in the `{ errors: [...] }` shape the other 400s use.
**Why:** It guards against a request that is not an extension call.

---

## Rule 5: Success is HTTP 200 with `{ actions }`, and the service never writes the cart itself

**What:** On success the handler answers **200** with `{ actions: [...] }`, and the platform
applies them. The calculator makes no platform write on the cart path.
**Why:** It is the API-extension contract: the platform applies the returned actions as part of
the same cart update.

---

## Rule 6: Provider errors on the re-apply path are mapped to specific responses

**What:** A failure of `tax.calculations.retrieve` during a re-apply (`tax-calculation.md` Rule 8, *A re-apply restores only the first stored calculation, without shipping keys or total prices*)
is re-thrown as the original provider error, so the error mapping applies:
- tax-rate codes → 400 `MissingTaxRateForCountry`;
- `stripe_tax_inactive` → 400;
- any other `StripeInvalidRequestError` / `StripeAPIError` → 500 `ExternalServiceError`;
- any other provider error type → the generic handler (Rule 3).

A `resource_missing` / HTTP 404 (the stored calculation is gone) is caught and the cart
**recalculated** (`tax-calculation.md` Rule 2), not mapped. Every other retrieve error is
re-thrown; only `StripeInvalidRequestError` / `StripeAPIError` (the tax-location codes and
`stripe_tax_inactive` above) get the specific responses. Auth, rate limit, permission and
connection errors fall to the generic handler (Rule 3), which returns their own status
(401 / 429 / 403, else 500).
