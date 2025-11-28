import Stripe from 'stripe';
import { validateAddress } from '../validators/address.validator.js';
import { logger } from '../utils/logger.utils.js';

const stripe = new Stripe(process.env.STRIPE_API_TOKEN);

/**
 * Address Service
 * Provides methods for address validation and Stripe verification
 * 1. Local validation using country-specific rules
 * 2. Stripe address verification (confirms Stripe accepts address for tax calculation)
 */
class AddressService {

  /**
   * Validate an address using local rules and verify with Stripe
   * @param {Object} address - Address to validate
   * @param {string} requestId - Request ID for logging
   * @returns {Promise<Object>} Validation result
   */
  async validateAddress(address, requestId = null) {
    // Step 0: Validate address structure
    const structureErrors = this.validateAddressStructure(address);
    if (structureErrors.length > 0) {
      return this.buildValidationResult({
        address: address || {},
        localValidation: {
          isValid: false,
          errors: structureErrors,
        },
        stripeVerification: null
      });
    }

    // Step 1: Local validation (business rules)
    const localValidation = this.performLocalValidation(address);

    // Step 2: Stripe verification (always if local validation passes)
    let stripeVerification = null;

    if (localValidation.isValid) {
      try {
        stripeVerification = await this.verifyAddressWithStripe(address, requestId);
      } catch (error) {
        logger.warn('Stripe verification failed', {
          requestId,
          error: error.message,
          code: error.code,
          type: error.type,
        });

        const errorCode = error.code || 'STRIPE_ERROR';
        const actionable = this.getActionableGuidance(errorCode);
        
        stripeVerification = {
          accepted: false,
          code: errorCode,
          userMessage: this.getUserFriendlyMessage(errorCode, error.message),
        };
        
        // Only include actionable if it exists
        if (actionable) {
          stripeVerification.actionable = actionable;
        }
      }
    }

    // Step 3: Build response
    return this.buildValidationResult({
      address,
      localValidation,
      stripeVerification
    });
  }

  /**
   * Validate address structure
   * @param {Object} address - Address to validate
   * @returns {Array} Array of validation errors
   * @private
   */
  validateAddressStructure(address) {
    const errors = [];

    // Validate address is an object
    if (!address || typeof address !== 'object' || Array.isArray(address)) {
      errors.push({
        code: 'INVALID_ADDRESS',
        message: 'Address must be a valid object',
      });
      return errors;
    }

    // Validate country exists
    if (!address.country) {
      errors.push({
        code: 'MISSING_COUNTRY',
        message: 'Country is required for address validation',
      });
    }

    // Validate country is a string
    if (address.country && typeof address.country !== 'string') {
      errors.push({
        code: 'INVALID_COUNTRY_TYPE',
        message: 'Country must be a string',
      });
    }

    return errors;
  }

  /**
   * Perform local validation using the existing validator
   * @param {Object} address - Address to validate
   * @returns {Object} Validation result
   * @private
   */
  performLocalValidation(address) {
    const errors = validateAddress(address);

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Verify that Stripe accepts the address for tax calculation
   * Creates a temporary calculation to verify address acceptance
   * @param {Object} address - Address to verify
   * @param {string} requestId - Request ID for logging
   * @returns {Promise<Object>} Verification result
   * @private
   */
  async verifyAddressWithStripe(address, requestId) {
    const currency =
      this.getCurrencyForCountry(address.country) ||
      process.env.ADDRESS_VALIDATION_STRIPE_DEFAULT_CURRENCY ||
      'usd';

    logger.debug('Verifying address with Stripe', {
      requestId,
      country: address.country,
      currency,
    });

    // Create temporary calculation to verify Stripe accepts the address
    const calculation = await stripe.tax.calculations.create({
      currency: currency,
      customer_details: {
        address: {
          line1: address.line1,
          line2: address.line2,
          city: address.city,
          state: address.state,
          postal_code: address.postal_code,
          country: address.country,
        },
        address_source: 'shipping',
      },
      line_items: [
        {
          amount: 100, // Minimum amount for verification
          reference: 'address-verification',
          tax_code: 'txcd_99999999',
        },
      ],
    });

    logger.debug('Stripe calculation created for address verification', {
      requestId,
      calculationId: calculation.id,
    });

    return {
      accepted: true,
    };
  }

  /**
   * Build complete validation result
   * @param {Object} address - Address to validate
   * @param {Object} localValidation - Local validation result
   * @param {Object} stripeVerification - Stripe verification result
   * @returns {Object} Validation result
   * @private
   */
  buildValidationResult({ address, localValidation, stripeVerification}) {
    // Address is valid only if:
    // 1. Local validation passes AND
    // 2. If verified with Stripe, it must be accepted
    const isValid =
      localValidation.isValid &&
      (stripeVerification === null || stripeVerification.accepted === true);

    return {
      success: isValid,
      validation: {
        local: localValidation,
        stripe: stripeVerification,
      },
      address: {
        suggestions: this.generateSuggestions(localValidation.errors, address),
      },
    };
  }

  /**
   * Generate suggestions based on validation errors
   * @param {Array} errors - Array of validation errors
   * @param {Object} address - Address to validate
   * @returns {Array} Array of suggestions
   * @private
   */
  generateSuggestions(errors, address) {
    const suggestions = [];

    errors.forEach((error) => {
      if (error.code === 'INVALID_POSTAL_CODE') {
        suggestions.push({
          field: 'postal_code',
          message: 'Please check the postal code format for your country',
          example: this.getPostalCodeExample(address.country),
        });
      }
      if (error.code === 'INVALID_STATE') {
        suggestions.push({
          field: 'state',
          message: 'Please use a valid state/province code',
          example: this.getStateExample(address.country),
        });
      }
      if (error.code.startsWith('MISSING_')) {
        const field = error.code.replace('MISSING_', '').toLowerCase();
        suggestions.push({
          field,
          message: `The field "${field}" is required for ${address.country}`,
          required: true,
        });
      }
    });

    return suggestions;
  }

  /**
   * Get postal code examples by country
   * @param {string} country - Country to get postal code example for
   * @returns {string} Postal code example
   * @private
   */
  getPostalCodeExample(country) {
    const examples = {
      US: '94105 or 94105-1234',
      CA: 'K1A 0B1',
      IN: '110001',
    };
    return examples[country] || 'Check your country format';
  }

  /**
   * Get state code examples by country
   * @param {string} country - Country to get state code example for
   * @returns {string} State code example
   * @private
   */
  getStateExample(country) {
    const examples = {
      US: 'CA, NY, TX',
      CA: 'ON, BC, QC',
    };
    return examples[country] || 'Use valid state/province code';
  }

  /**
   * Get default currency for country
   * @param {string} country - Country to get default currency for
   * @returns {string} Default currency
   * @private
   */
  getCurrencyForCountry(country) {
    const countryCurrencyMap = {
      US: 'usd',
      CA: 'cad',
      GB: 'gbp',
      AU: 'aud',
      NZ: 'nzd',
      // Zone Euro countries
      IE: 'eur',
      FR: 'eur',
      DE: 'eur',
      IT: 'eur',
      ES: 'eur',
      NL: 'eur',
      BE: 'eur',
      AT: 'eur',
      PT: 'eur',
      FI: 'eur',
      GR: 'eur',
      LU: 'eur',
      MT: 'eur',
      CY: 'eur',
      SK: 'eur',
      SI: 'eur',
      EE: 'eur',
      LV: 'eur',
      LT: 'eur',
    };
    return countryCurrencyMap[country] || null;
  }

  /**
   * Get user-friendly message based on error code
   * @param {string} errorCode - Error code to get user-friendly message for
   * @param {string} defaultMessage - Default message to return if no message is found for the error code
   * @returns {string} User-friendly message
   * @private
   */
  getUserFriendlyMessage(errorCode, defaultMessage) {
    const messages = {
      customer_tax_location_invalid:
        'The address cannot be used for tax calculation. Please verify the address is correct.',
      shipping_address_invalid:
        'The shipping address is invalid. Please check and correct the address.',
      invalid_tax_location:
        'Tax calculation is not available for this location.',
      taxes_calculation_failed: 'Unable to calculate taxes for this address.',
      stripe_tax_inactive: 'Stripe Tax is not activated in your account.',
    };

    return (
      messages[errorCode] || defaultMessage || 'Address verification failed.'
    );
  }

  /**
   * Get actionable guidance for the user
   * @param {string} errorCode - Error code to get actionable guidance for
   * @returns {Object} Actionable guidance
   * @private
   */
  getActionableGuidance(errorCode) {
    const guidance = {
      customer_tax_location_invalid: {
        action: 'Verify the address is complete and correct',
        steps: [
          'Check that all required fields are filled',
          'Verify postal code format matches country requirements',
          'Ensure state/province code is valid',
        ],
      },
      shipping_address_invalid: {
        action: 'Review and correct the shipping address',
        steps: [
          'Verify street address is correct',
          'Check city and state/province',
          'Confirm postal code is valid',
        ],
      },
      stripe_tax_inactive: {
        action: 'Enable Stripe Tax in your Stripe Dashboard',
        steps: [
          'Go to https://dashboard.stripe.com/settings/tax',
          'Follow the setup instructions',
          'Complete tax registration if required',
        ],
      },
    };

    return guidance[errorCode] || null;
  }
}

// Singleton instance
const addressService = new AddressService();

export default addressService;
export { AddressService };
