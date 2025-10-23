import stripe from 'stripe';
import configUtils from '../utils/config.util.js';

/**
 * Create Stripe client instance
 * This client can be used to make API calls to Stripe
 * Uses singleton pattern to ensure only one instance is created
 */
export const createStripeClient = ((stripeInstance) => () => {
  if (stripeInstance) {
    return stripeInstance;
  }

  const stripeApiToken = configUtils.readConfiguration().stripeApiToken;
  stripeInstance = new stripe(stripeApiToken);

  return stripeInstance;
})();
