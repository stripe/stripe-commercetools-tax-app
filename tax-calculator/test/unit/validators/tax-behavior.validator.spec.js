import { expect, describe, it } from '@jest/globals';
import { taxBehavior } from '../../../src/validators/helpers.validators.js';
import { getValidateMessages } from '../../../src/validators/helpers.validators.js';

describe('taxBehavior validator', () => {
  it('should validate inclusive tax behavior', () => {
    const validator = taxBehavior(['taxBehavior'], {
      code: 'InvalidTaxBehavior',
      message: 'Invalid tax behavior',
    });

    const item = { taxBehavior: 'inclusive' };
    const messages = getValidateMessages([validator], item);
    
    expect(messages).toHaveLength(0);
  });

  it('should validate exclusive tax behavior', () => {
    const validator = taxBehavior(['taxBehavior'], {
      code: 'InvalidTaxBehavior',
      message: 'Invalid tax behavior',
    });

    const item = { taxBehavior: 'exclusive' };
    const messages = getValidateMessages([validator], item);
    
    expect(messages).toHaveLength(0);
  });

  it('should validate automatic tax behavior', () => {
    const validator = taxBehavior(['taxBehavior'], {
      code: 'InvalidTaxBehavior',
      message: 'Invalid tax behavior',
    });

    const item = { taxBehavior: 'automatic' };
    const messages = getValidateMessages([validator], item);
    
    expect(messages).toHaveLength(0);
  });

  it('should validate case-insensitive tax behavior', () => {
    const validator = taxBehavior(['taxBehavior'], {
      code: 'InvalidTaxBehavior',
      message: 'Invalid tax behavior',
    });

    const item = { taxBehavior: 'INCLUSIVE' };
    const messages = getValidateMessages([validator], item);
    
    expect(messages).toHaveLength(0);
  });

  it('should reject invalid tax behavior', () => {
    const validator = taxBehavior(['taxBehavior'], {
      code: 'InvalidTaxBehavior',
      message: 'Invalid tax behavior',
    });

    const item = { taxBehavior: 'invalid' };
    const messages = getValidateMessages([validator], item);
    
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      code: 'InvalidTaxBehavior',
      message: 'Invalid tax behavior',
    });
  });

  it('should reject null tax behavior', () => {
    const validator = taxBehavior(['taxBehavior'], {
      code: 'InvalidTaxBehavior',
      message: 'Invalid tax behavior',
    });

    const item = { taxBehavior: null };
    const messages = getValidateMessages([validator], item);
    
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      code: 'InvalidTaxBehavior',
      message: 'Invalid tax behavior',
    });
  });

  it('should reject undefined tax behavior', () => {
    const validator = taxBehavior(['taxBehavior'], {
      code: 'InvalidTaxBehavior',
      message: 'Invalid tax behavior',
    });

    const item = { taxBehavior: undefined };
    const messages = getValidateMessages([validator], item);
    
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      code: 'InvalidTaxBehavior',
      message: 'Invalid tax behavior',
    });
  });
});
