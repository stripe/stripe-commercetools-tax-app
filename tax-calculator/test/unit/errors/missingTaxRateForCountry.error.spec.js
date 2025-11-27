import { expect, describe, it } from '@jest/globals';
import MissingTaxRateForCountry from '../../../src/errors/missingTaxRateForCountry.error.js';

describe('MissingTaxRateForCountry', () => {
  describe('constructor', () => {
    it('should create error with country only', () => {
      const error = new MissingTaxRateForCountry('XX');

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('MissingTaxRateForCountry');
      expect(error.country).toBe('XX');
      expect(error.state).toBeNull();
      expect(error.originalError).toBeNull();
      expect(error.statusCode).toBe(400);
      expect(error.message).toContain('Tax rate not available for country XX');
    });

    it('should create error with country and state', () => {
      const error = new MissingTaxRateForCountry('US', 'NY');

      expect(error.country).toBe('US');
      expect(error.state).toBe('NY');
      expect(error.message).toContain('Tax rate not available for country US (NY)');
    });

    it('should create error with country, state, and original error', () => {
      const originalError = {
        message: 'Stripe error message',
        code: 'taxes_calculation_failed',
        type: 'StripeInvalidRequestError'
      };

      const error = new MissingTaxRateForCountry('US', 'NY', originalError);

      expect(error.country).toBe('US');
      expect(error.state).toBe('NY');
      expect(error.originalError).toBe(originalError);
      expect(error.message).toContain('Tax rate not available for country US (NY)');
      expect(error.message).toContain('Stripe error message');
    });

    it('should create error with country and original error (no state)', () => {
      const originalError = {
        message: 'Stripe error message'
      };

      const error = new MissingTaxRateForCountry('XX', null, originalError);

      expect(error.country).toBe('XX');
      expect(error.state).toBeNull();
      expect(error.originalError).toBe(originalError);
      expect(error.message).toContain('Tax rate not available for country XX');
      expect(error.message).toContain('Stripe error message');
    });

    it('should have default message when no original error', () => {
      const error = new MissingTaxRateForCountry('XX');

      expect(error.message).toContain('This country may not be supported or tax registration is required.');
    });
  });

  describe('toCommerceToolsError', () => {
    it('should convert error to commercetools format without state', () => {
      const error = new MissingTaxRateForCountry('XX');
      const commercetoolsError = error.toCommerceToolsError();

      expect(commercetoolsError).toEqual({
        code: 'MissingTaxRateForCountry',
        message: 'Tax rate not available for country XX. This may be due to: (1) Country not supported by Stripe Tax, (2) No tax registration for this country, or (3) Invalid address preventing tax calculation.',
        extensionExtraInfo: {
          originalError: 'MissingTaxRateForCountry',
          country: 'XX',
          state: null,
          stripeErrorCode: undefined,
          stripeErrorType: undefined,
          stripeErrorMessage: undefined,
          action: 'Please verify: (1) Country is supported by Stripe Tax, (2) Tax registration exists for this country in Stripe Dashboard, (3) Customer address is valid and complete.'
        }
      });
    });

    it('should convert error to commercetools format with state', () => {
      const error = new MissingTaxRateForCountry('US', 'NY');
      const commercetoolsError = error.toCommerceToolsError();

      expect(commercetoolsError.code).toBe('MissingTaxRateForCountry');
      expect(commercetoolsError.message).toContain('Tax rate not available for country US and state NY');
      expect(commercetoolsError.extensionExtraInfo.country).toBe('US');
      expect(commercetoolsError.extensionExtraInfo.state).toBe('NY');
    });

    it('should include original Stripe error details', () => {
      const originalError = {
        message: 'Stripe error message',
        code: 'taxes_calculation_failed',
        type: 'StripeInvalidRequestError'
      };

      const error = new MissingTaxRateForCountry('US', 'NY', originalError);
      const commercetoolsError = error.toCommerceToolsError();

      expect(commercetoolsError.extensionExtraInfo.stripeErrorCode).toBe('taxes_calculation_failed');
      expect(commercetoolsError.extensionExtraInfo.stripeErrorType).toBe('StripeInvalidRequestError');
      expect(commercetoolsError.extensionExtraInfo.stripeErrorMessage).toBe('Stripe error message');
    });

    it('should handle original error without code or type', () => {
      const originalError = {
        message: 'Some error'
      };

      const error = new MissingTaxRateForCountry('XX', null, originalError);
      const commercetoolsError = error.toCommerceToolsError();

      expect(commercetoolsError.extensionExtraInfo.stripeErrorCode).toBeUndefined();
      expect(commercetoolsError.extensionExtraInfo.stripeErrorType).toBeUndefined();
      expect(commercetoolsError.extensionExtraInfo.stripeErrorMessage).toBe('Some error');
    });
  });

  describe('fromStripeError', () => {
    it('should create error from Stripe error with country only', () => {
      const stripeError = {
        message: 'Stripe error',
        code: 'taxes_calculation_failed',
        type: 'StripeInvalidRequestError'
      };

      const error = MissingTaxRateForCountry.fromStripeError(stripeError, 'XX');

      expect(error).toBeInstanceOf(MissingTaxRateForCountry);
      expect(error.country).toBe('XX');
      expect(error.state).toBeNull();
      expect(error.originalError).toBe(stripeError);
    });

    it('should create error from Stripe error with country and state', () => {
      const stripeError = {
        message: 'Stripe error',
        code: 'taxes_calculation_failed',
        type: 'StripeInvalidRequestError'
      };

      const error = MissingTaxRateForCountry.fromStripeError(stripeError, 'US', 'NY');

      expect(error).toBeInstanceOf(MissingTaxRateForCountry);
      expect(error.country).toBe('US');
      expect(error.state).toBe('NY');
      expect(error.originalError).toBe(stripeError);
    });

    it('should handle null state parameter', () => {
      const stripeError = {
        message: 'Stripe error'
      };

      const error = MissingTaxRateForCountry.fromStripeError(stripeError, 'XX', null);

      expect(error.country).toBe('XX');
      expect(error.state).toBeNull();
    });
  });
});

