import { serializeError } from 'serialize-error';
import { logger } from '../utils/logger.utils.js';
import extensionTemplate from './../../resources/api-extension.json' assert { type: 'json' };
import { ALL_CUSTOM_TYPES, TAX_CODE_CUSTOM_TYPE_NAME } from './customTypes.js';

/**
 * Create or update a commercetools API extension for tax calculation
 * @param {Object} apiRoot - commercetools API client
 * @param {string} ctpTaxCalculatorExtensionKey - Extension key identifier
 * @param {string} ctpExtensionBaseUrl - Base URL for the extension endpoint
 */
export async function createCTPExtension(
  apiRoot,
  ctpTaxCalculatorExtensionKey,
  ctpExtensionBaseUrl
) {
  try {
    if (!ctpExtensionBaseUrl) {
      throw new Error('ctpExtensionBaseUrl is required for extension creation');
    }

    logger.info(`Connect tax-integration deployment service url: ${ctpExtensionBaseUrl}`);

    const extensionDraft = {
      ...extensionTemplate,
      key: ctpTaxCalculatorExtensionKey,
      destination: {
        ...extensionTemplate.destination,
        url: ctpExtensionBaseUrl
      }
    };

    const response = await fetchExtensionByKey(
      apiRoot,
      ctpTaxCalculatorExtensionKey
    );
    const existingExtension = response?.results;
    if (existingExtension?.length) {
      await apiRoot
        .extensions()
        .withKey({ key: ctpTaxCalculatorExtensionKey })
        .delete({
          queryArgs: {
            version: existingExtension[0].version,
          },
        })
        .execute();
      logger.info(
        `Deleted existing API extension with key=${ctpTaxCalculatorExtensionKey} before creating new one`
      );
    } 
    await apiRoot.extensions().post({ body: extensionDraft}).execute();
    logger.info(
      'Successfully created an API extension for tax calculation ' +
      `key=${ctpTaxCalculatorExtensionKey}`
    );
  } catch (err) {
    throw Error(
      `Failed to sync API extension (key=${ctpTaxCalculatorExtensionKey}). ` +
        `Error: ${JSON.stringify(serializeError(err))}`
    );
  }
}

/**
 * Fetch extension by key from commercetools
 * @param {Object} apiRoot - commercetools API client
 * @param {string} key - Extension key
 * @returns {Promise<Object|null>} Extension body or null if not found
 */
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

/**
 * Delete a commercetools API extension by key
 * @param {Object} apiRoot - commercetools API client
 * @param {string} ctpTaxCalculatorExtensionKey - Extension key identifier
 */
export async function deleteCTPExtension(
  apiRoot,
  ctpTaxCalculatorExtensionKey
) {
  const response = await fetchExtensionByKey(
    apiRoot,
    ctpTaxCalculatorExtensionKey
  );
  const existingExtension = response?.results;
  if (existingExtension?.length) {
    await apiRoot
      .extensions()
      .withKey({ key: ctpTaxCalculatorExtensionKey })
      .delete({
        queryArgs: {
          version: existingExtension[0].version,
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

  for (const customType of ALL_CUSTOM_TYPES) {
    try {
      await addOrUpdateCustomType(apiRoot, customType);
      logger.info(`Custom type '${customType.key}' or field definitions related with Stripe Tax Connector have been created successfully`);
    } catch (error) {
      logger.error(`Failed to create custom type '${customType.key}' or field definitions related with Stripe Tax Connector:`, error);
      throw new Error(`Custom type creation or field definitions related with Stripe Tax Connector creation failed: ${error.message}`);
    }
  }

  logger.info('All custom types created successfully');
}

/**
 * Add or update a custom type
 * @param {Object} apiRoot - commercetools API client
 * @param {Object} customType - Custom type definition
 */
async function addOrUpdateCustomType(apiRoot, customType) {
  // Search for types by resourceTypeIds
  const types = await getCustomTypesByResourceTypeId(apiRoot, customType.resourceTypeIds[0]);

  // Update all types that match
  for (const type of types) {
    const updates = (customType.fieldDefinitions ?? [])
      .filter(
        (newFieldDefinition) =>
          !type.fieldDefinitions?.find(
            (existingFieldDefinition) =>
              newFieldDefinition.name === existingFieldDefinition.name
          )
      )
      .map((fieldDefinition) => ({
        action: 'addFieldDefinition',
        fieldDefinition: fieldDefinition,
      }));

    if (updates.length !== 0) {
      await apiRoot
        .types()
        .withKey({ key: type.key })
        .post({
          body: {
            version: type.version,
            actions: updates,
          },
        })
        .execute();
    }
  }

  // Create the type if it doesn't exist
  if (!types.find((type) => type.key === customType.key)) {
    await apiRoot
      .types()
      .post({
        body: customType,
      })
      .execute();
  }
}

/**
 * Get custom types by resourceTypeId
 * @param {Object} apiRoot - commercetools API client
 * @param {string} resourceTypeId - The resource type ID to search for
 * @returns {Promise<Array>} Array of custom types that match the resourceTypeId
 */
async function getCustomTypesByResourceTypeId(apiRoot, resourceTypeId) {
  try {
    const { body: { results: types } } = await apiRoot
      .types()
      .get({
        queryArgs: {
          where: `resourceTypeIds contains any ("${resourceTypeId}")`,
        },
      })
      .execute();
    
    return types || [];
  } catch (error) {
    if (error.statusCode === 404) {
      return [];
    }
    throw error;
  }
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

  for (const customType of ALL_CUSTOM_TYPES) {
    try {
      await deleteOrUpdateCustomType(apiRoot, customType);
      logger.info(`Field definitions or custom type '${customType.key}' related with Stripe Tax Connector have been removed successfully`);
    } catch (error) {
      logger.error('Could not remove custom type or field definitions related with Stripe Tax Connector:', error);
    }
  }

  logger.info('Custom type cleanup completed');
}

/**
 * Delete or update a custom type
 * @param {Object} apiRoot - commercetools API client
 * @param {Object} customType - Custom type definition
 */
async function deleteOrUpdateCustomType(apiRoot, customType) {
  // Search for types by resourceTypeIds
  const types = await getCustomTypesByResourceTypeId(apiRoot, customType.resourceTypeIds[0]);

  // Update all types that match
  for (const type of types) {
    const updates = (customType.fieldDefinitions ?? [])
      .filter(
        (newFieldDefinition) =>
          !!type.fieldDefinitions?.find(
            (existingFieldDefinition) =>
              newFieldDefinition.name === existingFieldDefinition.name
            )
      )
      .map((fieldDefinition) => ({
        action: 'removeFieldDefinition',
        fieldName: fieldDefinition.name,
      }));

    if (updates.length !== 0) {
      if (type.fieldDefinitions?.length === 1) {
        await apiRoot
          .types()
          .withKey({ key: type.key })
          .delete({
            queryArgs: {
              version: type.version,
            }
          })
          .execute();
      } else {
        await apiRoot
          .types()
          .withKey({ key: type.key })
          .post({
            body: {
              version: type.version,
              actions: updates,
            }
          })
          .execute();
      }
    }
  }
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

  try {
    for (const customTypeDefinition of ALL_CUSTOM_TYPES) {
      const typeValidation = {
        key: customTypeDefinition.key,
        exists: false,
        hasRequiredField: false,
        resourceTypes: []
      };

      try {
        // Get custom types by resourceTypeId and find the one with matching key
        const existingTypes = await getCustomTypesByResourceTypeId(apiRoot, customTypeDefinition.resourceTypeIds[0]);
        const customType = existingTypes.find(type => type.key === customTypeDefinition.key);
        
        if (customType) {
          typeValidation.exists = true;
          typeValidation.resourceTypes = customType.resourceTypeIds || [];
          typeValidation.hasRequiredField = customType.fieldDefinitions?.some(
            field => field.name === TAX_CODE_CUSTOM_TYPE_NAME
          );
          
          if (!typeValidation.hasRequiredField) {
            validationResult.isValid = false;
            validationResult.errors.push(
              `Custom type '${customTypeDefinition.key}' is missing required field ${TAX_CODE_CUSTOM_TYPE_NAME}`
            );
          }
        } else {
          validationResult.isValid = false;
          validationResult.errors.push(`Custom type '${customTypeDefinition.key}' does not exist`);
        }
      } catch (error) {
        validationResult.isValid = false;
        validationResult.errors.push(`Failed to validate custom type '${customTypeDefinition.key}': ${error.message}`);
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