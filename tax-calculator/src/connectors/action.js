import _ from 'lodash';
import { serializeError } from 'serialize-error';
import { logger } from '../utils/logger.utils.js';
import extensionTemplate from "./../../resources/api-extension.json" assert { type: 'json' };

export async function createCTPExtension(
  apiRoot,
  ctpTaxCalculatorExtensionKey,
  ctpExtensionBaseUrl
) {
  try {
    // This code creates an "extensionDraft" object by first converting the imported JSON template (extensionTemplate)
    // into a string, then using lodash's template function to replace placeholders in the string with the provided
    // values (ctpTaxCalculatorExtensionKey and ctpExtensionBaseUrl). The result is a string with the placeholders
    // replaced, which is then parsed back into a JavaScript object using JSON.parse.
    // This allows dynamic insertion of runtime values into a static JSON template.
    const extensionDraft = JSON.parse(
      _.template(JSON.stringify(extensionTemplate))({
        ctpTaxCalculatorExtensionKey,
        ctpExtensionBaseUrl,
      })
    );

    logger.info(`Connect tax-integration deployment service url: ${ctpExtensionBaseUrl} `)

    const response = await fetchExtensionByKey(
      apiRoot,
      ctpTaxCalculatorExtensionKey
    );
    const existingExtension = response?.results;
    if (existingExtension?.length) {
      const updateActions = buildUpdateActions(existingExtension[0], extensionDraft);
      if (updateActions.length > 0) {
        await apiRoot
            .extensions()
            .withId({ ID: existingExtension[0].id })
            .post({
              body: {
                actions: updateActions,
                version: existingExtension[0].version,
              },
            })
            .execute();
        logger.info(
            'Successfully updated the API extension for payment resource type ' +
            `key=${ctpTaxCalculatorExtensionKey}`
        );
      } else {
        logger.info('No update actions found to update CTP Extension ' +
            `key=${ctpTaxCalculatorExtensionKey}` );
      }
    } else {
      await apiRoot.extensions().post({ body: extensionDraft}).execute();
      logger.info(
          'Successfully created an API extension for payment resource type ' +
          `key=${ctpTaxCalculatorExtensionKey}`
      );
    }
  } catch (err) {
    throw Error(
      `Failed to sync API extension (key=${ctpTaxCalculatorExtensionKey}). ` +
        `Error: ${JSON.stringify(serializeError(err))}`
    );
  }
}

function buildUpdateActions(existingExtension, extensionDraft) {
  const actions = [];
  if (!_.isEqual(existingExtension.destination, extensionDraft.destination))
    actions.push({
      action: 'changeDestination',
      destination: extensionDraft.destination,
    });

  if (!_.isEqual(existingExtension.triggers, extensionDraft.triggers))
    actions.push({
      action: 'changeTriggers',
      triggers: extensionDraft.triggers,
    });

  return actions;
}

async function fetchExtensionByKey(apiRoot, key) {
  try {
    const { body } = await apiRoot
      .extensions()
      .get({
        queryArgs: {
          where: `key = "${key}"`,
        },
      })
      .execute();
    return body;
  } catch (err) {
    if (err.statusCode === 404) return null;
    throw err;
  }
}

export async function deleteCTPExtension(
  apiRoot,
  ctpTaxCalculatorExtensionKey
) {
  const existingExtension = await fetchExtensionByKey(
    apiRoot,
    ctpTaxCalculatorExtensionKey
  );
  if (existingExtension !== null) {
    await apiRoot
      .extension()
      .withKey({ key: ctpTaxCalculatorExtensionKey })
      .delete({
        queryArgs: {
          version: existingExtension.version,
        },
      })
      .execute();
  } else {
    logger.info(
      'No API extension found for the given key ' +
        `(key=${ctpTaxCalculatorExtensionKey})`
    );
  }
}

/**
 * Validate that all categories in TAX_CODE_MAPPING_JSON exist in commercetools
 *
 * This validation ensures that the tax code mapping configuration is valid before
 * the connector is fully installed. Since tax-calculator uses this mapping at runtime
 * for tax code lookups, we validate during installation to catch configuration errors early.
 *
 * @param {Object} apiRoot - commercetools API client
 * @param {Object} mapping - Parsed tax code mapping
 * @throws {Error} If a category doesn't exist
 */
export async function validateTaxCodeMapping(apiRoot, mapping) {
  // If mapping is empty or has no categories, allow installation
  if (!mapping || !mapping.categories || mapping.categories.length === 0) {
    logger.info('TAX_CODE_MAPPING_JSON is empty or not provided. Connector will be installed with empty mapping.');
    return;
  }

  logger.info(`Validating ${mapping.categories.length} category mappings...`);

  // Validate each category mapping
  for (let i = 0; i < mapping.categories.length; i++) {
    const entry = mapping.categories[i];
    const { ctCategory } = entry;

    if (!ctCategory || typeof ctCategory !== 'object') {
      throw new Error(
        `Invalid mapping at index ${i}: ctCategory must be an object`
      );
    }

    const { id, key } = ctCategory;

    // Skip validation if both id and key are missing (this should have been caught by config validation)
    if (!id && !key) {
      throw new Error(
        `Invalid mapping at index ${i}: ctCategory must have either "id" or "key"`
      );
    }

    // Build query to check if category exists
    const whereClauses = [];
    if (id) {
      whereClauses.push(`id="${id}"`);
    }
    if (key) {
      whereClauses.push(`key="${key}"`);
    }

    const whereQuery = whereClauses.join(' or ');

    try {
      const {
        body: { results: categories },
      } = await apiRoot
        .categories()
        .get({
          queryArgs: {
            where: whereQuery,
            limit: 1,
          },
        })
        .execute();

      if (!categories || categories.length === 0) {
        const identifierDesc = id && key ? `id="${id}" or key="${key}"` : id ? `id="${id}"` : `key="${key}"`;
        throw new Error(
          `Category validation failed: Category with ${identifierDesc} does not exist in commercetools project. ` +
            `Please ensure all categories in TAX_CODE_MAPPING_JSON exist before installing the connector.`
        );
      }

      // Log successful validation
      const identifierDesc = id && key ? `id="${id}", key="${key}"` : id ? `id="${id}"` : `key="${key}"`;
      logger.info(`Category validated: ${identifierDesc} -> ${entry.taxCode}`);
    } catch (error) {
      if (error.message.includes('Category validation failed')) {
        throw error;
      }
      throw new Error(
        `Failed to validate category mapping at index ${i}: ${error.message}`
      );
    }
  }

  logger.info(`All ${mapping.categories.length} category mappings validated successfully`);
}
