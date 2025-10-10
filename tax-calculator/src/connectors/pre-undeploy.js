import 'dotenv/config';

import { createApiRoot } from '../clients/create.client.js';
import { deleteCTPExtension } from './action.js';
import { CTP_TAX_CALCULATOR_EXTENSION_KEY } from './constants.js';
import { logger } from '../utils/logger.utils.js';

async function preUndeploy() {
  const apiRoot = createApiRoot();
  await deleteCTPExtension(apiRoot, CTP_TAX_CALCULATOR_EXTENSION_KEY);
}

async function run() {
  try {
    await preUndeploy();
  } catch (error) {
    logger.error('Pre-undeploy failed', { error: error.message, stack: error.stack });
    process.exitCode = 1;
  }
}

run();
