/**
 * Thrown when the cart carries a delivery address that cannot serve as a tax destination.
 *
 * The tax destination is the country Stripe uses to pick the jurisdiction, so it must come from
 * one place — the delivery address — and be complete. commercetools requires `country` on every
 * Address, so a delivery address that names a city, a postal code or a street but no country did
 * not come through the normal cart API. Rather than completing it from `cart.country` (which
 * selects the price and is shopper-controlled) and calculating tax against an address that exists
 * in no single jurisdiction, the extension refuses the update.
 *
 * Results in a commercetools InvalidInput validation error (400). See SB3-218.
 */
class InvalidTaxDestinationError extends Error {
  /**
   * @param {Object} address - The delivery address as received from commercetools
   * @param {string} [shippingKey] - Shipping method key, in Multiple shipping mode
   */
  constructor(address = {}, shippingKey = null) {
    const present = ['city', 'postalCode', 'streetName', 'state']
      .filter((field) => address?.[field]);
    const scope = shippingKey ? ` for shipping method "${shippingKey}"` : '';

    super(
      `Delivery address${scope} has no country but specifies ${present.join(', ')}. ` +
      'A tax destination must come entirely from the delivery address.'
    );

    this.name = 'InvalidTaxDestinationError';
    this.address = address;
    this.shippingKey = shippingKey;
    this.presentFields = present;
    this.statusCode = 400;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, InvalidTaxDestinationError);
    }
  }

  /**
   * Convert to the commercetools API Extension error format.
   * @returns {Object} Error object in commercetools format
   */
  toCommercetoolsError() {
    const scope = this.shippingKey ? ` for shipping method "${this.shippingKey}"` : '';

    return {
      code: 'InvalidInput',
      message:
        `Cannot calculate tax: the delivery address${scope} is missing a country. ` +
        'Tax is determined by where the order is delivered, so the delivery address must carry ' +
        'its own country — the cart country selects prices and cannot stand in for it.',
      extensionExtraInfo: {
        originalError: this.name,
        shippingKey: this.shippingKey,
        presentFields: this.presentFields,
        action:
          'Set a complete delivery address on the cart (setShippingAddress, or the shipping ' +
          'method address in Multiple shipping mode) including its country, then retry.'
      }
    };
  }
}

export default InvalidTaxDestinationError;
