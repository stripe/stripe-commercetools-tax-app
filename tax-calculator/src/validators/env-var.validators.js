import {
  optional,
  standardString,
  standardKey,
  region,
  stripeApiToken,
} from './helpers.validators.js';

/**
 * Create here your own validators
 */
const envValidators = [
  standardString(
    ['clientId'],
    {
      code: 'InValidClientId',
      message: 'Client id should be 24 characters.',
      referencedBy: 'environmentVariables',
    },
    { min: 24, max: 24 }
  ),

  standardString(
    ['clientSecret'],
    {
      code: 'InvalidClientSecret',
      message: 'Client secret should be 32 characters.',
      referencedBy: 'environmentVariables',
    },
    { min: 32, max: 32 }
  ),

  standardKey(['projectKey'], {
    code: 'InvalidProjectKey',
    message: 'Project key should be a valid string.',
    referencedBy: 'environmentVariables',
  }),

  optional(standardString)(
    ['scope'],
    {
      code: 'InvalidScope',
      message: 'Scope should be at least 2 characters long.',
      referencedBy: 'environmentVariables',
    },
    { min: 2, max: undefined }
  ),

  region(['region'], {
    code: 'InvalidRegion',
    message: 'Not a valid region.',
    referencedBy: 'environmentVariables',
  }),

  stripeApiToken(['stripeApiToken'], {
    code: 'InvalidStripeApiToken',
    message: 'Stripe API token must start with sk_test_ or sk_live_.',
    referencedBy: 'environmentVariables',
  }),

  optional(standardString)(
    ['stripeConnectedAccountId'],
    {
      code: 'InvalidStripeConnectedAccountId',
      message: 'Stripe Connected Account ID should be at least 2 characters long.',
      referencedBy: 'environmentVariables',
    },
    { min: 2, max: undefined }
  ),
];

export default envValidators;
