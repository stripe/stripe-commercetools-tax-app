import 'dotenv/config';

import { createApiRoot } from '../clients/create.client.js';
import { deleteCTPExtension } from './action.js';
import { CTP_TAX_CALCULATOR_EXTENSION_KEY } from './constants.js';
import { deleteCustomTypes } from './action.js';

/**
 * Performs pre-undeploy cleanup operations
 * Deletes the commercetools API extension and custom types
 */
async function preUndeploy() {
  const apiRoot = createApiRoot();

  // Step 1: Delete API extension
  await deleteCTPExtension(apiRoot, CTP_TAX_CALCULATOR_EXTENSION_KEY);

  // Step 2: Delete custom types
  await deleteCustomTypes(apiRoot, true);
}

/**
 * Main entry point for pre-undeploy script
 * Executes preUndeploy and handles errors by writing to stderr and setting exit code
 */
async function run() {
  try {
    await preUndeploy();
  } catch (error) {
    process.stderr.write(`Pre-undeploy failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

run();