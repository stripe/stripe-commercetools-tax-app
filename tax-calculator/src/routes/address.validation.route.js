import { Router } from 'express';
import { validateAddressHandler } from '../controllers/address.validation.controller.js';
import { rateLimiterMiddleware } from '../middlewares/rate.limiter.middleware.js';

const addressValidationRouter = Router();

// Rate limiting configuration from environment variables
const RATE_LIMIT_REQUESTS = parseInt(process.env.ADDRESS_VALIDATION_RATE_LIMIT || '100', 10);
const RATE_LIMIT_WINDOW = parseInt(process.env.ADDRESS_VALIDATION_WINDOW_MINUTES || '1', 10);

addressValidationRouter.post(
    '/validateAddress',
    rateLimiterMiddleware(RATE_LIMIT_REQUESTS, RATE_LIMIT_WINDOW),
    validateAddressHandler
);

export default addressValidationRouter;