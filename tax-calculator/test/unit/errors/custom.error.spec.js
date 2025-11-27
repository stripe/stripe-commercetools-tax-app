import { expect, describe, it } from '@jest/globals';
import CustomError from '../../../src/errors/custom.error.js';

describe('CustomError', () => {
  it('should create error with statusCode and message', () => {
    const error = new CustomError(400, 'Test error message');

    expect(error).toBeInstanceOf(Error);
    expect(error.statusCode).toBe(400);
    expect(error.message).toBe('Test error message');
    expect(error.errors).toBeUndefined();
  });

  it('should create error with statusCode, message, and errors', () => {
    const errors = [
      { field: 'email', message: 'Invalid email' },
      { field: 'password', message: 'Password too short' }
    ];
    const error = new CustomError(400, 'Validation failed', errors);

    expect(error.statusCode).toBe(400);
    expect(error.message).toBe('Validation failed');
    expect(error.errors).toEqual(errors);
  });

  it('should be throwable and catchable', () => {
    expect(() => {
      throw new CustomError(500, 'Server error');
    }).toThrow('Server error');

    try {
      throw new CustomError(404, 'Not found');
    } catch (error) {
      expect(error).toBeInstanceOf(CustomError);
      expect(error.statusCode).toBe(404);
    }
  });
});

