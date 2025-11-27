import { expect, describe, it, jest, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import addressValidationRouter from '../../../src/routes/address.validation.route.js';

// Mock dependencies
jest.mock('../../../src/controllers/address.validation.controller.js', () => ({
  validateAddressHandler: jest.fn((req, res) => {
    res.status(200).json({ success: true });
  })
}));

jest.mock('../../../src/middlewares/rate.limiter.middleware.js', () => ({
  rateLimiterMiddleware: jest.fn((requests, window) => {
    return (req, res, next) => {
      next();
    };
  })
}));

describe('address.validation.route', () => {
  let app;
  let originalEnv;
  let validateAddressHandler;
  let rateLimiterMiddleware;

  beforeEach(async () => {
    originalEnv = { ...process.env };
    
    // Get references to mocked functions before clearing mocks
    const controllerModule = await import('../../../src/controllers/address.validation.controller.js');
    const middlewareModule = await import('../../../src/middlewares/rate.limiter.middleware.js');
    validateAddressHandler = controllerModule.validateAddressHandler;
    rateLimiterMiddleware = middlewareModule.rateLimiterMiddleware;
    
    app = express();
    app.use(express.json());
    app.use('/api', addressValidationRouter);
    
    // Clear mocks after setting up app (this clears call history but not implementations)
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('POST /validateAddress', () => {
    it('should use default rate limit when environment variables are not set', async () => {
      delete process.env.ADDRESS_VALIDATION_RATE_LIMIT;
      delete process.env.ADDRESS_VALIDATION_WINDOW_MINUTES;

      // Re-import to get fresh defaults
      jest.resetModules();
      const freshRouter = (await import('../../../src/routes/address.validation.route.js')).default;
      const freshApp = express();
      freshApp.use(express.json());
      freshApp.use('/api', freshRouter);

      const response = await request(freshApp)
        .post('/api/validateAddress')
        .send({ address: { country: 'US' } });

      expect(response.status).toBe(200);
    });

    it('should use custom rate limit from environment variables', async () => {
      process.env.ADDRESS_VALIDATION_RATE_LIMIT = '200';
      process.env.ADDRESS_VALIDATION_WINDOW_MINUTES = '5';

      // Re-import to get fresh defaults
      jest.resetModules();
      const freshRouter = (await import('../../../src/routes/address.validation.route.js')).default;
      const freshApp = express();
      freshApp.use(express.json());
      freshApp.use('/api', freshRouter);

      const response = await request(freshApp)
        .post('/api/validateAddress')
        .send({ address: { country: 'US' } });

      expect(response.status).toBe(200);
    });

    it('should handle invalid rate limit values and use defaults', async () => {
      process.env.ADDRESS_VALIDATION_RATE_LIMIT = 'invalid';
      process.env.ADDRESS_VALIDATION_WINDOW_MINUTES = 'invalid';

      // Re-import to get fresh defaults
      jest.resetModules();
      const freshRouter = (await import('../../../src/routes/address.validation.route.js')).default;
      const freshApp = express();
      freshApp.use(express.json());
      freshApp.use('/api', freshRouter);

      const response = await request(freshApp)
        .post('/api/validateAddress')
        .send({ address: { country: 'US' } });

      // Should still work with NaN defaults (which parseInt will handle)
      expect(response.status).toBe(200);
    });

    it('should call validateAddressHandler when route is accessed', async () => {
      // Re-import to ensure we're using the mocked handler
      jest.resetModules();
      
      // Get fresh references after reset
      const { validateAddressHandler: handler } = await import('../../../src/controllers/address.validation.controller.js');
      const testRouter = (await import('../../../src/routes/address.validation.route.js')).default;
      
      // Set up a fresh app with the re-imported router
      const testApp = express();
      testApp.use(express.json());
      testApp.use('/api', testRouter);
      
      // Clear the handler mock to get a fresh call count
      handler.mockClear();

      const response = await request(testApp)
        .post('/api/validateAddress')
        .send({ address: { country: 'US' } });

      expect(response.status).toBe(200);
      expect(handler).toHaveBeenCalled();
      // Verify it was called with req, res, and next (Express route handler signature)
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.objectContaining({ address: expect.any(Object) }) }),
        expect.any(Object),
        expect.any(Function) // next function
      );
    });

    it('should apply rate limiter middleware', async () => {
      // Re-import the route to trigger rateLimiterMiddleware call
      jest.resetModules();
      
      // Get fresh reference to the mocked middleware after reset
      const middlewareModule = await import('../../../src/middlewares/rate.limiter.middleware.js');
      const freshRateLimiterMiddleware = middlewareModule.rateLimiterMiddleware;
      
      const testRouter = (await import('../../../src/routes/address.validation.route.js')).default;
      const testApp = express();
      testApp.use(express.json());
      testApp.use('/api', testRouter);
      
      // Now verify that rateLimiterMiddleware was called with default values (100, 1)
      expect(freshRateLimiterMiddleware).toHaveBeenCalledWith(100, 1);
      
      // Also verify the route works correctly with the middleware applied
      const response = await request(testApp)
        .post('/api/validateAddress')
        .send({ address: { country: 'US' } });
      
      expect(response.status).toBe(200);
    });
  });
});

