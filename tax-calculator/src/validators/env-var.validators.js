import {
  optional,
  standardString,
  standardKey,
  region,
  taxBehavior,
  jsonObject,
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

  taxBehavior(['taxBehaviorDefault'], {
    code: 'InvalidTaxBehaviorDefault',
    message: 'Tax behavior default should be one of: inclusive, exclusive, automatic.',
    referencedBy: 'environmentVariables',
  }),

  jsonObject(['countryTaxBehaviorMapping'], {
    code: 'InvalidCountryTaxBehaviorMapping',
    message: 'Country tax behavior mapping should be valid JSON object.',
    referencedBy: 'environmentVariables',
  }),

  optional(standardString)(
    ['taxBehaviorCustomFieldName'],
    {
      code: 'InvalidTaxBehaviorCustomFieldName',
      message: 'Tax behavior custom field name should be a valid string.',
      referencedBy: 'environmentVariables',
    },
    { min: 1, max: 50 }
  ),
];

export default envValidators;
