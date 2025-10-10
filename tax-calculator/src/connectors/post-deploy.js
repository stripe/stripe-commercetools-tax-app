import 'dotenv/config';

import { createApiRoot } from '../clients/create.client.js';
import { createCTPExtension } from './action.js';
import { validateStripeTax } from './stripeTaxValidator.js';
import { logger } from '../utils/logger.utils.js';
import {
  CONNECT_SERVICE_URL,
  CTP_TAX_CALCULATOR_EXTENSION_KEY,
} from './constants.js';

/**
 * Post-deployment function that validates Stripe Tax configuration and creates the commercetools extension.
 * This function is called after the connector is deployed to ensure proper setup and configuration.
 * 
 * @param {Map} properties - Map containing environment variables and configuration properties
 * @throws {Error} When required properties are missing or validation/creation fails
 * @returns {Promise<void>} Resolves when post-deploy process completes successfully
 */
async function postDeploy(properties) {
  const ctpExtensionBaseUrl = properties.get(CONNECT_SERVICE_URL);
  const stripeApiToken = properties.get('TAX_PROVIDER_API_TOKEN');

  // Validate required properties
  if (!stripeApiToken) {
    throw new Error('TAX_PROVIDER_API_TOKEN is required for Stripe Tax validation');
  }

  if (!ctpExtensionBaseUrl) {
    throw new Error('CONNECT_SERVICE_URL is required for extension creation');
  }

  logger.info('Starting post-deploy process...');
  logger.info('Validating Stripe Tax configuration...');
  await validateStripeTax(stripeApiToken);

  logger.info('Creating commercetools extension...');
  const apiRoot = createApiRoot();
  await createCTPExtension(
    apiRoot,
    CTP_TAX_CALCULATOR_EXTENSION_KEY,
    ctpExtensionBaseUrl
  );

  logger.info('Post-deploy completed successfully');
  logger.info('Stripe Tax connector is ready for tax calculations');

}

async function run() {
  try {
    const properties = new Map(Object.entries(process.env));
    await postDeploy(properties);
  } catch (error) {
    logger.error('Post-deploy failed', { error: error.message, stack: error.stack });
    process.exitCode = 1;
  }
}

run();
