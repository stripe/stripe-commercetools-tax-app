import 'dotenv/config';

import { createApiRoot } from '../clients/create.client.js';
import { createCTPExtension, validateTaxCodeMapping, createCustomTypes } from './action.js';
import {
  CONNECT_SERVICE_URL,
  CTP_TAX_CALCULATOR_EXTENSION_KEY,
  TAX_CODE_MAPPING_JSON_KEY,
} from './constants.js';
import { logger } from '../utils/logger.utils.js';

async function postDeploy(properties) {
  //The URL of deployed connector could be obtained via env-var CONNECT_SERVICE_URL after deployment.
  const ctpExtensionBaseUrl = properties.get(CONNECT_SERVICE_URL);
  const taxCodeMappingJson = properties.get(TAX_CODE_MAPPING_JSON_KEY);

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
          `Invalid TAX_CODE_MAPPING_JSON format: ${error.message}`
        );
      }
      throw error;
    }
  } else {
    logger.info('TAX_CODE_MAPPING_JSON not provided. Connector will be installed with empty mapping.');
  }

  // Step 2: Create custom types
  await createCustomTypes(apiRoot);

  // Step 3: Create API extension for tax calculation
  await createCTPExtension(
    apiRoot,
    CTP_TAX_CALCULATOR_EXTENSION_KEY,
    ctpExtensionBaseUrl
  );
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
