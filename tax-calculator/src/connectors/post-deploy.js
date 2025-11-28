import 'dotenv/config';

import { createApiRoot } from '../clients/create.client.js';
import { createCTPExtension, validateTaxCodeMapping, createCustomTypes } from './action.js';
import { validateStripeTax } from '../validators/stripeTaxValidator.js';
import { logger } from '../utils/logger.utils.js';
import {
  CONNECT_SERVICE_URL,
  CTP_TAX_CALCULATOR_EXTENSION_KEY,
  STRIPE_API_TOKEN,
  TAX_CODE_CATEGORY_MAPPING_JSON_KEY,
} from './constants.js';

/**
 * Post-deployment function that validates Stripe Tax configuration and creates the commercetools extension.
 * This function is called after the connector is deployed to ensure proper setup and configuration.
 * 
 * @param {Map} properties - Map containing environment variables and configuration properties
 * @throws {Error} When required properties are missing or validation/creation fails
 * @returns {Promise<void>} Resolves when post-deploy process completes successfully
 */
export async function postDeploy(properties) {
  const ctpExtensionBaseUrl = properties.get(CONNECT_SERVICE_URL);
  const stripeApiToken = properties.get(STRIPE_API_TOKEN);

  // Validate required properties
  if (!stripeApiToken) {
    throw new Error(STRIPE_API_TOKEN + ' is required for Stripe Tax validation');
  }

  if (!ctpExtensionBaseUrl) {
    throw new Error(CONNECT_SERVICE_URL + ' is required for extension creation');
  }

  logger.info('Starting post-deploy process...');
  logger.info('Validating Stripe Tax configuration...');
  await validateStripeTax(stripeApiToken);

  logger.info('Creating commercetools extension...');  
  const taxCodeMappingJson = properties.get(TAX_CODE_CATEGORY_MAPPING_JSON_KEY);

  const apiRoot = createApiRoot();

  // Step 1: Create custom types for tax code configuration
  if (taxCodeMappingJson) {
    try {
      const mapping = JSON.parse(taxCodeMappingJson);
      await validateTaxCodeMapping(apiRoot, mapping);
    } catch (error) {
      process.stderr.write(`Post-deploy failed: ${error.message}\n`);
      if (error instanceof SyntaxError) {
        throw new Error(
          `Invalid TAX_CODE_CATEGORY_MAPPING_JSON format: ${error.message}`
        );
      }
      throw error;
    }
  } else {
    logger.info('TAX_CODE_CATEGORY_MAPPING_JSON not provided. Connector will be installed with empty mapping.');
  }

  // Step 2: Create custom types
  await createCustomTypes(apiRoot);

  // Step 3: Create API extension for tax calculation
  await createCTPExtension(
    apiRoot,
    CTP_TAX_CALCULATOR_EXTENSION_KEY,
    ctpExtensionBaseUrl
  );

  logger.info('Post-deploy completed successfully');
  logger.info('Stripe Tax connector is ready for tax calculations');

}

export async function run() {
  try {
    const properties = new Map(Object.entries(process.env));
    await postDeploy(properties);
  } catch (error) {
    process.stderr.write(`Post-deploy failed: ${error.message}\n${error.stack}\n`);
    process.exitCode = 1;
  }
}

run();
