import _ from 'lodash';
import { serializeError } from 'serialize-error';
import { logger } from '../utils/logger.utils.js';
import extensionTemplate from "./../../resources/api-extension.json" assert { type: 'json' };
import {
  PRODUCT_TAX_CUSTOM_TYPE,
  CATEGORY_TAX_CUSTOM_TYPE,
  SHIPPING_TAX_CUSTOM_TYPE,
} from './customTypes.js';

const TAX_CODE_CUSTOM_TYPE_NAME = 'connectorTaxStripe_Code';

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

/**
 * Create all required custom types for Stripe Tax connector
 * This function is called during post-deploy to set up custom types
 * 
 * @param {Object} apiRoot - commercetools API client
 */
export async function createCustomTypes(apiRoot) {
  logger.info('Creating custom types for Stripe Tax connector...');

  const customTypes = [
    PRODUCT_TAX_CUSTOM_TYPE,
    CATEGORY_TAX_CUSTOM_TYPE,
    SHIPPING_TAX_CUSTOM_TYPE
  ];

  for (const customType of customTypes) {
    try {
      await createCustomType(apiRoot, customType);
    } catch (error) {
      logger.error(`Failed to create custom type '${customType.key}':`, error);
      throw new Error(`Custom type creation failed: ${error.message}`);
    }
  }

  logger.info('All custom types created successfully');
}

/**
 * Create a single custom type
 * @param {Object} apiRoot - commercetools API client
 * @param {Object} customTypeDef - Custom type definition
 */
async function createCustomType(apiRoot, customTypeDef) {
  const typeKey = customTypeDef.key;

  try {
    // Check if custom type already exists
    const existingType = await getCustomType(apiRoot, typeKey);

    if (existingType) {
      logger.info(`Custom type '${typeKey}' already exists, checking for updates...`);
      await updateCustomTypeIfNeeded(apiRoot, existingType, customTypeDef);
    } else {
      logger.info(`Creating custom type '${typeKey}'...`);
      await createNewCustomType(apiRoot, customTypeDef);
    }
  } catch (error) {
    logger.error(`Failed to ensure custom type '${typeKey}': ${error.message}`);
    throw error;
  }
}

/**
 * Get existing custom type by key
 * @param {Object} apiRoot - commercetools API client
 * @param {string} key - Custom type key
 * @returns {Object|null} Custom type or null if not found
 */
async function getCustomType(apiRoot, key) {
  try {
    const response = await apiRoot
      .types()
      .withKey({ key })
      .get()
      .execute();
    return response.body;
  } catch (error) {
    if (error.statusCode === 404) {
      return null; // Type doesn't exist
    }
    throw error;
  }
}

/**
 * Create a new custom type
 * @param {Object} apiRoot - commercetools API client
 * @param {Object} customTypeDef - Custom type definition
 */
async function createNewCustomType(apiRoot, customTypeDef) {
  const response = await apiRoot
    .types()
    .post({ body: customTypeDef })
    .execute();

  logger.info(`Custom type '${customTypeDef.key}' created successfully`, {
    id: response.body.id,
    key: response.body.key,
    resourceTypes: customTypeDef.resourceTypeIds
  });

  return response.body;
}

/**
 * Update existing custom type if needed
 * @param {Object} apiRoot - commercetools API client
 * @param {Object} existingType - Existing custom type
 * @param {Object} customTypeDef - Desired custom type definition
 */
async function updateCustomTypeIfNeeded(apiRoot, existingType, customTypeDef) {
  // Check if required field exists
  const hasRequiredField = existingType.fieldDefinitions?.some(
    field => field.name === TAX_CODE_CUSTOM_TYPE_NAME
  );

  if (hasRequiredField) {
    logger.info(`Custom type '${customTypeDef.key}' already has required fields`);
    return existingType;
  }

  // Add missing field about Stripe tax code
  logger.info(`Adding missing field to custom type '${customTypeDef.key}'...`);

  const updateActions = [{
    action: 'addFieldDefinition',
    fieldDefinition: customTypeDef.fieldDefinitions[0]
  }];

  const response = await apiRoot
    .types()
    .withKey({ key: existingType.key })
    .post({
      body: {
        version: existingType.version,
        actions: updateActions
      }
    })
    .execute();

  logger.info(`Custom type '${customTypeDef.key}' updated successfully`);
  return response.body;
}

/**
 * Delete all custom types created by the connector
 * This function is called during pre-undeploy to clean up custom types
 * 
 * @param {Object} apiRoot - commercetools API client
 * @param {boolean} cleanupCustomTypes - Whether to remove custom types (default: false)
 */
export async function deleteCustomTypes(apiRoot, cleanupCustomTypes = false) {
  if (!cleanupCustomTypes) {
    logger.info('Custom type cleanup disabled. Custom types will remain in commercetools.');
    return;
  }

  logger.info('Cleaning up custom types...');

  const customTypeKeys = [
    PRODUCT_TAX_CUSTOM_TYPE.key,
    CATEGORY_TAX_CUSTOM_TYPE.key,
    SHIPPING_TAX_CUSTOM_TYPE.key
  ];

  for (const typeKey of customTypeKeys) {
    try {
      const existingType = await getCustomType(apiRoot, typeKey);
      
      if (existingType) {
        await apiRoot
          .types()
          .withKey({ key: typeKey })
          .delete({ 
            queryArgs: { 
              version: existingType.version 
            } 
          })
          .execute();
        
        logger.info(`Custom type '${typeKey}' removed successfully`);
      } else {
        logger.info(`Custom type '${typeKey}' not found, skipping...`);
      }
    } catch (error) {
      if (error.statusCode === 404) {
        logger.info(`Custom type '${typeKey}' already removed`);
      } else {
        logger.warn(`Could not remove custom type '${typeKey}': ${error.message}`);
      }
    }
  }

  logger.info('Custom type cleanup completed');
}

/**
 * Validate that custom types exist and are properly configured
 * This can be used for health checks or validation during connector startup
 * 
 * @param {Object} apiRoot - commercetools API client
 * @returns {Object} Validation result with status and details
 */
export async function validateCustomTypes(apiRoot) {
  const validationResult = {
    isValid: true,
    customTypes: [],
    errors: []
  };

  const customTypeKeys = [
    PRODUCT_TAX_CUSTOM_TYPE.key,
    CATEGORY_TAX_CUSTOM_TYPE.key,
    SHIPPING_TAX_CUSTOM_TYPE.key
  ];

  try {
    for (const typeKey of customTypeKeys) {
      const typeValidation = {
        key: typeKey,
        exists: false,
        hasRequiredField: false,
        resourceTypes: []
      };

      try {
        const customType = await getCustomType(apiRoot, typeKey);
        
        if (customType) {
          typeValidation.exists = true;
          typeValidation.resourceTypes = customType.resourceTypeIds || [];

          // Check if required field exists
          const hasRequiredField = customType.fieldDefinitions?.some(
            field => field.name === TAX_CODE_CUSTOM_TYPE_NAME
          );
          
          typeValidation.hasRequiredField = hasRequiredField;
          
          if (!hasRequiredField) {
            validationResult.isValid = false;
            validationResult.errors.push(
              `Custom type '${typeKey}' is missing required field ${TAX_CODE_CUSTOM_TYPE_NAME}`
            );
          }
        } else {
          validationResult.isValid = false;
          validationResult.errors.push(`Custom type '${typeKey}' does not exist`);
        }
      } catch (error) {
        validationResult.isValid = false;
        validationResult.errors.push(`Failed to validate custom type '${typeKey}': ${error.message}`);
      }

      validationResult.customTypes.push(typeValidation);
    }

    if (validationResult.isValid) {
      logger.info('All custom types are properly configured');
    } else {
      logger.warn('Some custom types have configuration issues', validationResult.errors);
    }

    return validationResult;
  } catch (error) {
    logger.error('Custom type validation failed:', error);
    validationResult.isValid = false;
    validationResult.errors.push(`Validation failed: ${error.message}`);
    return validationResult;
  }
}