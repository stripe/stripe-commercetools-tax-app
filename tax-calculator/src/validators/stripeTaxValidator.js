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
      const settings = await this.stripe.tax.settings.retrieve();

      if (!settings) {
        throw new Error(
          'Unable to retrieve Stripe Tax settings.'
        );
      }

      // Validate status
      await this.validateTaxStatus(settings);

      // Auto-populate environment variables from Stripe settings
      this.autoPopulateDefaults(settings);

      logger.info('Stripe Tax validation successful');
      return settings;

    } catch (error) {
      throw new Error(`Stripe Tax validation failed: ${error.message}`, { cause: error });
    }
  }

  /**
   * Validates that Stripe Tax status is 'active'
   * @param {Object} settings - Stripe Tax settings object
   * @returns {Promise<void>}
   * @throws {Error} If Stripe Tax is not active or missing required configuration
   */
  async validateTaxStatus(settings) {
    if (settings.status === 'pending') {
      const missingFields = settings.status_details?.pending?.missing_fields || [];
      throw new Error(
        `Stripe Tax is not active. Status: pending. Missing configuration: ${missingFields.join(', ')}. `
      );
    }

    if (settings.status !== 'active') {
      throw new Error(
        `Stripe Tax is not enabled. Status: ${settings.status}. `
      );
    }

    if (!settings.head_office) {
      throw new Error(
        `Stripe Tax lacks the head office address configuration.`
      );
    }
  }

  /**
   * Auto-populate TAX_BEHAVIOR_DEFAULT and TAX_CODE_DEFAULT from Stripe settings
   * @param {Object} settings - Stripe Tax settings object
   */
  autoPopulateDefaults(settings) {
    if (!process.env.TAX_BEHAVIOR_DEFAULT && settings.defaults?.tax_behavior) {
      process.env.TAX_BEHAVIOR_DEFAULT = settings.defaults.tax_behavior;
      logger.info(`Using Stripe default tax_behavior: ${settings.defaults.tax_behavior}`);
    }


    if (!process.env.TAX_CODE_DEFAULT && settings.defaults?.tax_code) {
      process.env.TAX_CODE_DEFAULT = settings.defaults.tax_code;
      logger.info(`Using Stripe default tax_code: ${settings.defaults.tax_code}`);
    }
  }
}

/**
 * Convenience function for postDeploy hook
 */
export async function validateStripeTax(apiToken) {
  const validator = new StripeTaxValidator(apiToken);
  return await validator.validateStripeTaxSettings();
}
