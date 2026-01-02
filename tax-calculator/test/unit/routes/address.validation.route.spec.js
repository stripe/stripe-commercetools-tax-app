import { expect, describe, it, jest, beforeEach } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import addressValidationRouter from '../../../src/routes/address.validation.route.js';

// Mock dependencies
jest.mock('../../../src/controllers/address.validation.controller.js', () => ({
  validateAddressHandler: jest.fn((req, res) => {
    res.status(200).json({ success: true });
  })
}));

describe('address.validation.route', () => {
  let app;
  let validateAddressHandler;

  beforeEach(async () => {
    // Get references to mocked functions before clearing mocks
    const controllerModule = await import('../../../src/controllers/address.validation.controller.js');
    validateAddressHandler = controllerModule.validateAddressHandler;
    
    app = express();
    app.use(express.json());
    app.use('/api', addressValidationRouter);
    
    // Clear mocks after setting up app (this clears call history but not implementations)
    jest.clearAllMocks();
  });

  describe('POST /validateAddress', () => {
    it('should return 200 when route is accessed', async () => {
      const response = await request(app)
        .post('/api/validateAddress')
        .send({ address: { country: 'US' } });

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
  });
});
