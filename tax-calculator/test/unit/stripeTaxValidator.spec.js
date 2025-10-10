import { expect, describe, it, jest, beforeEach, afterEach } from '@jest/globals';
import { StripeTaxValidator, validateStripeTax } from '../../src/connectors/stripeTaxValidator.js';

// Mock the stripe module
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    tax: {
      settings: {
        retrieve: jest.fn()
      }
    }
  }));
});


describe('StripeTaxValidator', () => {
  let validator;
  let mockStripe;
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    
    validator = new StripeTaxValidator('sk_test_mock_token');
    mockStripe = validator.stripe;
    
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('constructor', () => {
    it('should initialize with API token', () => {
      const testToken = 'sk_test_123456';
      const validator = new StripeTaxValidator(testToken);
      
      expect(validator.stripe).toBeDefined();
    });
  });

  describe('validateStripeTaxSettings', () => {
    it('should successfully validate active Stripe Tax settings', async () => {
      const mockSettings = {
        status: 'active',
        head_office: { address: '123 Main St' },
        defaults: {
          tax_behavior: 'inclusive',
          tax_code: 'txcd_123456'
        }
      };

      mockStripe.tax.settings.retrieve.mockResolvedValue(mockSettings);

      const result = await validator.validateStripeTaxSettings();

      expect(result).toEqual(mockSettings);
      expect(mockStripe.tax.settings.retrieve).toHaveBeenCalled();
    });

    it('should throw error when settings are null', async () => {
      mockStripe.tax.settings.retrieve.mockResolvedValue(null);

      await expect(validator.validateStripeTaxSettings()).rejects.toThrow(
        'Stripe Tax validation failed: Unable to retrieve Stripe Tax settings.'
      );
    });

    it('should throw error when settings are undefined', async () => {
      mockStripe.tax.settings.retrieve.mockResolvedValue(undefined);

      await expect(validator.validateStripeTaxSettings()).rejects.toThrow(
        'Stripe Tax validation failed: Unable to retrieve Stripe Tax settings.'
      );
    });

    it('should handle Stripe API errors with generic wrapper', async () => {
      const stripeError = new Error('API Error');
      mockStripe.tax.settings.retrieve.mockRejectedValue(stripeError);

      await expect(validator.validateStripeTaxSettings()).rejects.toThrow(
        'Stripe Tax validation failed: API Error'
      );
    });

    it('should handle validation errors with generic wrapper', async () => {
      const mockSettings = {
        status: 'inactive'
      };
      mockStripe.tax.settings.retrieve.mockResolvedValue(mockSettings);

      await expect(validator.validateStripeTaxSettings()).rejects.toThrow(
        'Stripe Tax validation failed: Stripe Tax is not enabled. Status: inactive.'
      );
    });

  });

  describe('validateTaxStatus', () => {
    it('should pass validation for active status with head office', async () => {
      const settings = {
        status: 'active',
        head_office: { address: '123 Main St' }
      };

      // Should not throw
      await expect(validator.validateTaxStatus(settings)).resolves.toBeUndefined();
    });

    it('should throw error for pending status', async () => {
      const settings = {
        status: 'pending',
        status_details: {
          pending: {
            missing_fields: ['business_type', 'tax_id']
          }
        }
      };

      await expect(validator.validateTaxStatus(settings)).rejects.toThrow(
        'Stripe Tax is not active. Status: pending. Missing configuration: business_type, tax_id.'
      );
    });

    it('should throw error for pending status without missing fields', async () => {
      const settings = {
        status: 'pending',
        status_details: {
          pending: {}
        }
      };

      await expect(validator.validateTaxStatus(settings)).rejects.toThrow(
        'Stripe Tax is not active. Status: pending. Missing configuration: .'
      );
    });

    it('should throw error for inactive status', async () => {
      const settings = {
        status: 'inactive'
      };

      await expect(validator.validateTaxStatus(settings)).rejects.toThrow(
        'Stripe Tax is not enabled. Status: inactive.'
      );
    });

    it('should throw error when head office is missing', async () => {
      const settings = {
        status: 'active',
        head_office: null
      };

      await expect(validator.validateTaxStatus(settings)).rejects.toThrow(
        'Stripe Tax lacks the head office address configuration'
      );
    });

    it('should throw error when head office is undefined', async () => {
      const settings = {
        status: 'active'
      };

      await expect(validator.validateTaxStatus(settings)).rejects.toThrow(
        'Stripe Tax lacks the head office address configuration'
      );
    });
  });

  describe('autoPopulateDefaults', () => {
    it('should set TAX_BEHAVIOR_DEFAULT when not already set', () => {
      const settings = {
        defaults: {
          tax_behavior: 'inclusive',
          tax_code: 'txcd_123456'
        }
      };

      // Ensure env var is not set
      delete process.env.TAX_BEHAVIOR_DEFAULT;

      validator.autoPopulateDefaults(settings);

      expect(process.env.TAX_BEHAVIOR_DEFAULT).toBe('inclusive');
    });

    it('should set TAX_CODE_DEFAULT when not already set', () => {
      const settings = {
        defaults: {
          tax_behavior: 'inclusive',
          tax_code: 'txcd_123456'
        }
      };

      // Ensure env var is not set
      delete process.env.TAX_CODE_DEFAULT;

      validator.autoPopulateDefaults(settings);

      expect(process.env.TAX_CODE_DEFAULT).toBe('txcd_123456');
    });

    it('should not override existing TAX_BEHAVIOR_DEFAULT', () => {
      const settings = {
        defaults: {
          tax_behavior: 'inclusive',
          tax_code: 'txcd_123456'
        }
      };

      // Set existing env var
      process.env.TAX_BEHAVIOR_DEFAULT = 'exclusive';

      validator.autoPopulateDefaults(settings);

      expect(process.env.TAX_BEHAVIOR_DEFAULT).toBe('exclusive');
    });

    it('should not override existing TAX_CODE_DEFAULT', () => {
      const settings = {
        defaults: {
          tax_behavior: 'inclusive',
          tax_code: 'txcd_123456'
        }
      };

      // Set existing env var
      process.env.TAX_CODE_DEFAULT = 'txcd_existing';

      validator.autoPopulateDefaults(settings);

      expect(process.env.TAX_CODE_DEFAULT).toBe('txcd_existing');
    });

    it('should handle settings without defaults', () => {
      const settings = {};

      // Ensure env vars are not set
      delete process.env.TAX_BEHAVIOR_DEFAULT;
      delete process.env.TAX_CODE_DEFAULT;

      validator.autoPopulateDefaults(settings);

      expect(process.env.TAX_BEHAVIOR_DEFAULT).toBeUndefined();
      expect(process.env.TAX_CODE_DEFAULT).toBeUndefined();
    });

    it('should handle settings with partial defaults', () => {
      const settings = {
        defaults: {
          tax_behavior: 'inclusive'
          // tax_code is missing
        }
      };

      // Ensure env vars are not set
      delete process.env.TAX_BEHAVIOR_DEFAULT;
      delete process.env.TAX_CODE_DEFAULT;

      validator.autoPopulateDefaults(settings);

      expect(process.env.TAX_BEHAVIOR_DEFAULT).toBe('inclusive');
      expect(process.env.TAX_CODE_DEFAULT).toBeUndefined();
    });
  });

});

describe('validateStripeTax', () => {
  let mockStripe;

  beforeEach(() => {
    jest.clearAllMocks();
    mockStripe = {
      tax: {
        settings: {
          retrieve: jest.fn()
        }
      }
    };
  });

  it('should create validator and call validateStripeTaxSettings', async () => {
    const mockSettings = {
      status: 'active',
      head_office: { address: '123 Main St' }
    };

    // Mock the Stripe constructor to return our mock
    const StripeMock = require('stripe');
    StripeMock.mockImplementation(() => mockStripe);
    mockStripe.tax.settings.retrieve.mockResolvedValue(mockSettings);

    const result = await validateStripeTax('sk_test_token');

    expect(result).toEqual(mockSettings);
    expect(StripeMock).toHaveBeenCalledWith('sk_test_token');
    expect(mockStripe.tax.settings.retrieve).toHaveBeenCalled();
  });

  it('should propagate errors from validator', async () => {
    const error = new Error('Validation failed');
    
    // Mock the Stripe constructor to return our mock
    const StripeMock = require('stripe');
    StripeMock.mockImplementation(() => mockStripe);
    mockStripe.tax.settings.retrieve.mockRejectedValue(error);

    await expect(validateStripeTax('sk_test_token')).rejects.toThrow(
      'Stripe Tax validation failed: Validation failed'
    );
  });
});
