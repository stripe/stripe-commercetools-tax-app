/**
 * Custom error thrown when Stripe cannot calculate taxes for a specific country
 * This should result in a commercetools MissingTaxRateForCountry validation error (400) response
 *
 * This error is thrown when:
 * - The country is not supported by Stripe Tax
 * - No tax registration exists for the country
 * - The address cannot be used to determine tax rates
 */
class MissingTaxRateForCountry extends Error {
  constructor(country, state = null, originalError = null) {
    const stateInfo = state ? ` (${state})` : '';
    const message = `Tax rate not available for country ${country}${stateInfo}. ${
      originalError ? originalError.message : 'This country may not be supported or tax registration is required.'
    }`;

    super(message);

    this.name = 'MissingTaxRateForCountry';
    this.country = country;
    this.state = state;
    this.originalError = originalError;
    this.statusCode = 400; // Bad Request - validation error

    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, MissingTaxRateForCountry);
    }
  }

  /**
   * Convert error to commercetools API Extension error format
   * This matches the commercetools MissingTaxRateForCountry error format
   * @returns {Object} Error object in commercetools format
   */
  toCommerceToolsError() {
    const stateInfo = this.state ? ` and state ${this.state}` : '';

    return {
      code: 'MissingTaxRateForCountry',
      message: `Tax rate not available for country ${this.country}${stateInfo}. This may be due to: (1) Country not supported by Stripe Tax, (2) No tax registration for this country, or (3) Invalid address preventing tax calculation.`,
      extensionExtraInfo: {
        originalError: this.name,
        country: this.country,
        state: this.state,
        stripeErrorCode: this.originalError?.code,
        stripeErrorType: this.originalError?.type,
        stripeErrorMessage: this.originalError?.message,
        action: 'Please verify: (1) Country is supported by Stripe Tax, (2) Tax registration exists for this country in Stripe Dashboard, (3) Customer address is valid and complete.'
      }
    };
  }

  /**
   * Create MissingTaxRateForCountry from Stripe error
   * @param {Object} stripeError - Stripe API error object
   * @param {string} country - Country code
   * @param {string} state - State/province code (optional)
   * @returns {MissingTaxRateForCountry}
   */
  static fromStripeError(stripeError, country, state = null) {
    return new MissingTaxRateForCountry(country, state, stripeError);
  }
}

export default MissingTaxRateForCountry;
