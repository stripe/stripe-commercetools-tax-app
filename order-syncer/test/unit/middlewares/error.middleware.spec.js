import { expect, describe, it, jest } from '@jest/globals';
import { errorMiddleware } from '../../../src/middlewares/error.middleware.js';
import CustomError from '../../../src/errors/custom.error.js';

describe('error.middleware.spec', () => {
  let mockRequest;
  let mockResponse;
  let mockNext;

  beforeEach(() => {
    mockRequest = {};
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();
  });

  describe('errorMiddleware', () => {
    it('should handle CustomError with statusCode and return JSON response', () => {
      const statusCode = 400;
      const errorMessage = 'Validation error';
      const customError = new CustomError(statusCode, errorMessage);

      errorMiddleware(customError, mockRequest, mockResponse, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(statusCode);
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: errorMessage,
        errors: undefined,
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle CustomError with errors array', () => {
      const statusCode = 422;
      const errorMessage = 'Multiple validation errors';
      const errors = [
        { code: 'Error1', message: 'First error' },
        { code: 'Error2', message: 'Second error' },
      ];
      const customError = new CustomError(statusCode, errorMessage, errors);

      errorMiddleware(customError, mockRequest, mockResponse, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(statusCode);
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: errorMessage,
        errors: errors,
      });
    });

    it('should handle CustomError with numeric statusCode', () => {
      const statusCode = 202;
      const errorMessage = 'Accepted';
      const customError = new CustomError(statusCode, errorMessage);

      errorMiddleware(customError, mockRequest, mockResponse, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(statusCode);
      expect(mockResponse.json).toHaveBeenCalled();
    });

    it('should return 500 for non-CustomError errors', () => {
      const genericError = new Error('Generic error');

      errorMiddleware(genericError, mockRequest, mockResponse, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.send).toHaveBeenCalledWith('Internal server error');
      expect(mockResponse.json).not.toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 500 for CustomError without statusCode', () => {
      const customError = new CustomError(null, 'Error without status');
      customError.statusCode = null;

      errorMiddleware(customError, mockRequest, mockResponse, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.send).toHaveBeenCalledWith('Internal server error');
    });

    it('should return 500 for CustomError with non-numeric statusCode', () => {
      const customError = new CustomError('invalid', 'Error with invalid status');
      customError.statusCode = 'invalid';

      errorMiddleware(customError, mockRequest, mockResponse, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.send).toHaveBeenCalledWith('Internal server error');
    });

    it('should handle empty errors array in CustomError', () => {
      const statusCode = 400;
      const errorMessage = 'Error with empty errors';
      const customError = new CustomError(statusCode, errorMessage, []);

      errorMiddleware(customError, mockRequest, mockResponse, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(statusCode);
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: errorMessage,
        errors: [],
      });
    });

    it('should not call next middleware', () => {
      const customError = new CustomError(400, 'Test error');

      errorMiddleware(customError, mockRequest, mockResponse, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle different HTTP status codes', () => {
      const statusCodes = [200, 201, 400, 401, 404, 422, 500, 503];

      statusCodes.forEach((statusCode) => {
        const customError = new CustomError(statusCode, `Error ${statusCode}`);
        mockResponse.status.mockClear();
        mockResponse.json.mockClear();

        errorMiddleware(customError, mockRequest, mockResponse, mockNext);

        expect(mockResponse.status).toHaveBeenCalledWith(statusCode);
      });
    });
  });
});

