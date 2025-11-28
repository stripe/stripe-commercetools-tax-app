import Stripe from 'stripe';
import { loadConfig } from '../configurations/config.js';
import { ORDER_TAX_FIELD_NAMES } from '../../../connectors/customTypes.js';

let stripeClient;

/**
 * Create a new Stripe client.
 * @returns {Stripe} The Stripe client.
 */
function createClient() {
  const apiToken = loadConfig().taxProviderApiToken;
  return new Stripe(apiToken);
}

/**
 * Create a new tax transaction.
 * @param {string} orderId - The ID of the order.
 * @param {object} cart - The cart object.
 * @returns {Promise<Array<object>>} The tax transactions.
 */
export default async function createTaxTransaction(orderId, cart) {
  if (!stripeClient) stripeClient = createClient();

  const calculationReferences = cart?.custom?.fields?.[ORDER_TAX_FIELD_NAMES.CALCULATION_REFERENCES];
  const taxTransactions = [];

  if (!calculationReferences || !Array.isArray(calculationReferences) || calculationReferences.length === 0) {
    throw new Error('Missing calculation references.');
  }

  for (const calculationReference of calculationReferences) {
    const txnCreateFromCalculationParams = {
      calculation: calculationReference,
      reference: orderId,
      metadata: {
        ct_order_id: orderId
      }
    };

    const response = await stripeClient.tax.transactions.createFromCalculation(txnCreateFromCalculationParams);
    taxTransactions.push(response);
  }

  return taxTransactions;
}
