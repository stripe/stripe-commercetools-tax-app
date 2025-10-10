import 'dotenv/config';

import { createApiRoot } from '../clients/create.client.js';
import { createCTPExtension } from './action.js';
import { validateStripeTax } from './stripeTaxValidator.js';
import { logger } from '../utils/logger.utils.js';
import {
  CONNECT_SERVICE_URL,
  CTP_TAX_CALCULATOR_EXTENSION_KEY,
} from './constants.js';

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

  try {
    logger.info('Starting post-deploy process...');

    // Step 1: Validate Stripe Tax settings BEFORE creating extension
    logger.info('Step 1: Validating Stripe Tax configuration...');
    await validateStripeTax(stripeApiToken);

    // Step 2: Create commercetools API extension
    logger.info('Step 2: Creating commercetools extension...');
    const apiRoot = createApiRoot();
    await createCTPExtension(
      apiRoot,
      CTP_TAX_CALCULATOR_EXTENSION_KEY,
      ctpExtensionBaseUrl
    );

    logger.info('Post-deploy completed successfully');
    logger.info('Stripe Tax connector is ready for tax calculations');

  } catch (error) {
    logger.error('Post-deploy failed:', error.message);
    logger.error('Troubleshooting tips:');
    logger.error('   - Verify Stripe Tax is enabled in your Stripe Dashboard');
    logger.error('   - Check that your API key has Tax permissions');
    logger.error('   - Ensure head office address is configured');
    logger.error('   - Visit: https://dashboard.stripe.com/tax/settings');
    
    // Exit with error code 1 to fail deployment
    process.exit(1);
  }
}

async function run() {
  try {
    const properties = new Map(Object.entries(process.env));
    await postDeploy(properties);
  } catch (error) {
    process.stderr.write(`Post-deploy failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

run();
