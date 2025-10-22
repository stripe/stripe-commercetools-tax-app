import 'dotenv/config';

import { createApiRoot } from '../clients/create.client.js';
import { deleteCTPExtension } from './action.js';
import { CTP_TAX_CALCULATOR_EXTENSION_KEY } from './constants.js';
import { deleteCustomTypes } from './action.js';
import { logger } from '../utils/logger.utils.js';

async function preUndeploy() {
  const apiRoot = createApiRoot();

  // Step 1: Delete API extension
  await deleteCTPExtension(apiRoot, CTP_TAX_CALCULATOR_EXTENSION_KEY);

  // Step 2: Delete custom types
  await deleteCustomTypes(apiRoot, true);
}

async function run() {
  try {
    await preUndeploy();
  } catch (error) {
    process.stderr.write(`Pre-undeploy failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

run();
