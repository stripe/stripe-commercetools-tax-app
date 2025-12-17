import { logger } from '../utils/logger.util.js'
import { MESSAGE_TYPE } from '../constants/connectors.constants.js';
import { ORDER_TAX_CUSTOM_TYPE } from './customTypes.js';

/**
 * Create a changed order subscription
 * This function is called during post-deploy to create a subscription to the Pub/Sub topic
 * 
 * @param {Object} apiRoot - commercetools API client
 * @param {string} topicName - The name of the Pub/Sub topic
 * @param {string} projectId - The ID of the project
 * @param {string} ctpOrderChangeSubscriptionKey - The key of the subscription
 */
export async function createChangedOrderSubscription(
  apiRoot,
  topicName,
  projectId,
  ctpOrderChangeSubscriptionKey
) {
  await deleteChangedOrderSubscription(apiRoot, ctpOrderChangeSubscriptionKey);

  await apiRoot
    .subscriptions()
    .post({
      body: {
        key: ctpOrderChangeSubscriptionKey,
        destination: {
          type: 'GoogleCloudPubSub',
          topic: topicName,
          projectId,
        },
        messages: [
          {
            resourceTypeId: 'order',
            types: MESSAGE_TYPE,
          },
        ],
      },
    })
    .execute();

  logger.info(`Subscription created successfully in project ${projectId} with topic ${topicName}`);
}

/**
 * Delete a changed order subscription
 * This function is called during pre-undeploy to delete the subscription to the Pub/Sub topic
 * 
 * @param {Object} apiRoot - commercetools API client
 * @param {string} ctpOrderChangeSubscriptionKey - The key of the subscription
 */
export async function deleteChangedOrderSubscription(
  apiRoot,
  ctpOrderChangeSubscriptionKey
) {
  const {
    body: { results: subscriptions },
  } = await apiRoot
    .subscriptions()
    .get({
      queryArgs: {
        where: `key = "${ctpOrderChangeSubscriptionKey}"`,
      },
    })
    .execute();

  if (subscriptions.length > 0) {
    const subscription = subscriptions[0];

    await apiRoot
      .subscriptions()
      .withKey({ key: ctpOrderChangeSubscriptionKey })
      .delete({
        queryArgs: {
          version: subscription.version,
        },
      })
      .execute();
    
    logger.info(`Subscription deleted successfully with key ${ctpOrderChangeSubscriptionKey}`);
  }
}

/**
 * Create all required custom types for Order Syncer
 * This function is called during post-deploy to set up custom types
 * 
 * @param {Object} apiRoot - commercetools API client
 */
export async function createCustomTypes(apiRoot) {
  logger.info('Creating Custom Types for Order Syncer');

  try {
    await addOrUpdateCustomType(apiRoot, ORDER_TAX_CUSTOM_TYPE);
    logger.info(`Custom Type '${ORDER_TAX_CUSTOM_TYPE.key}' or field definitions related with Order Syncer have been created successfully`);
  } catch (error) {
    logger.error(`Failed to create custom type '${ORDER_TAX_CUSTOM_TYPE.key}' or field definitions related with Order Syncer: ${error.message}`);
    throw new Error(`Custom type creation or field definitions related with Order Syncer creation failed: ${error.message}`);
  }
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
 * Delete all custom types created by the Order Syncer
 * This function is called during pre-undeploy to clean up custom types
 * 
 * @param {Object} apiRoot - commercetools API client
 * @param {boolean} cleanupCustomTypes - Whether to remove custom types (default: false)
 */
export async function deleteCustomTypes(apiRoot, cleanupCustomTypes = false) {
  if (!cleanupCustomTypes) {
    logger.info('Custom Type cleanup disabled. Custom Types will remain in commercetools.');
    return;
  }

  logger.info('Cleaning up Custom Types');

  try {
    await deleteOrUpdateCustomType(apiRoot, ORDER_TAX_CUSTOM_TYPE);
    logger.info(`Field definitions or Custom Type '${ORDER_TAX_CUSTOM_TYPE.key}' related with Order Syncer have been removed successfully`);
  } catch (error) {
    logger.error(`Could not remove custom type or field definitions related with Order Syncer: ${error.message}`);
  }

  logger.info('Custom Types for Order Syncer cleanup completed');
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
