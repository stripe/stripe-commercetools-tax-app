import stripe from 'stripe';
import { logger } from '../utils/logger.utils.js';

export class StripeTaxValidator {
  constructor(apiToken) {
    this.stripe = new stripe(apiToken);
  }

  /**
   * Validates Stripe Tax settings and ensures they are active
   * @returns {Promise<Object>} Stripe Tax settings object
   * @throws {Error} If validation fails
   */
  async validateStripeTaxSettings() {
    logger.info('Validating Stripe Tax settings...');

    try {
      // Retrieve current tax settings
      const settings = await this.stripe.tax.settings.retrieve(this.options);

      if (!settings) {
        throw new Error(
          'Unable to retrieve Stripe Tax settings. Verify API key permissions.'
        );
      }

      // Validate status
      await this.validateTaxStatus(settings);

      // Auto-populate environment variables from Stripe settings
      this.autoPopulateDefaults(settings);

      // Log warnings for incomplete configuration
      this.logConfigurationWarnings(settings);

      logger.info('Stripe Tax validation successful - Status: active');
      return settings;

    } catch (error) {
      this.handleStripeError(error);
    }
  }

  /**
   * Validates that Stripe Tax status is 'active'
   */
  async validateTaxStatus(settings) {
    if (settings.status === 'pending') {
      const missingFields = settings.status_details?.pending?.missing_fields || [];
      throw new Error(
        `Stripe Tax is not active. Status: pending. Missing configuration: ${missingFields.join(', ')}. ` +
        `Configure Stripe Tax at: https://dashboard.stripe.com/tax/settings`
      );
    }

    if (settings.status !== 'active') {
      throw new Error(
        `Stripe Tax is not enabled. Status: ${settings.status}. ` +
        `Enable it at: https://dashboard.stripe.com/tax/registrations`
      );
    }
  }

  /**
   * Auto-populate TAX_BEHAVIOR_DEFAULT and TAX_CODE_DEFAULT from Stripe settings
   */
  autoPopulateDefaults(settings) {
    // Use Stripe's default tax behavior if not specified
    if (!process.env.TAX_BEHAVIOR_DEFAULT && settings.defaults?.tax_behavior) {
      process.env.TAX_BEHAVIOR_DEFAULT = settings.defaults.tax_behavior;
      logger.info(`Using Stripe default tax_behavior: ${settings.defaults.tax_behavior}`);
    }

    // Use Stripe's default tax code if not specified
    if (!process.env.TAX_CODE_DEFAULT && settings.defaults?.tax_code) {
      process.env.TAX_CODE_DEFAULT = settings.defaults.tax_code;
      logger.info(`Using Stripe default tax_code: ${settings.defaults.tax_code}`);
    }
  }

  /**
   * Log warnings for missing or incomplete configuration
   */
  logConfigurationWarnings(settings) {
    // Warning for missing head office
    if (!settings.head_office) {
      logger.warn('Head office address not configured in Stripe Tax');
    }

    // Warning for missing optional fields
    if (settings.status_details?.active?.missing_fields?.length > 0) {
      logger.warn(
        `Missing optional Stripe Tax fields: ${settings.status_details.active.missing_fields.join(', ')}`
      );
    }

    // Log head office information if available
    if (settings.head_office?.address) {
      const addr = settings.head_office.address;
      logger.info(`Head office: ${addr.city}, ${addr.state}, ${addr.country}`);
    }
  }

  /**
   * Handle Stripe API errors with clear messages
   */
  handleStripeError(error) {
    if (error.type === 'StripePermissionError') {
      throw new Error(
        'Stripe API key lacks Tax permissions. Grant access in Stripe Dashboard.'
      );
    } else if (error.statusCode === 401) {
      throw new Error(
        'Invalid Stripe API key. Check TAX_PROVIDER_API_TOKEN.'
      );
    } else if (error.statusCode === 403) {
      throw new Error(
        'Stripe API key does not have access to Tax settings. Verify permissions.'
      );
    }
    
    // Re-throw with original message for other errors
    throw new Error(`Stripe Tax validation failed: ${error.message}`);
  }
}

/**
 * Convenience function for postDeploy hook
 */
export async function validateStripeTax(apiToken, connectedAccountId = null) {
  const validator = new StripeTaxValidator(apiToken, connectedAccountId);
  return await validator.validateStripeTaxSettings();
}
