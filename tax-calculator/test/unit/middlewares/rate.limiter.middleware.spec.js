import { expect, describe, it, jest, beforeEach } from '@jest/globals';
import { rateLimiterMiddleware } from '../../../src/middlewares/rate.limiter.middleware.js';

// Mock express-rate-limit
jest.mock('express-rate-limit', () => {
  return jest.fn((options) => {
    // Return a middleware function that calls the handler when limit is exceeded
    return (req, res, next) => {
      // Simulate rate limit check
      if (options.handler) {
        // Call handler to test it
        return options.handler(req, res);
      }
      next();
    };
  });
});

import rateLimit from 'express-rate-limit';

describe('rateLimiterMiddleware', () => {
  let mockRequest;
  let mockResponse;
  let statusSpy;
  let jsonSpy;
  let nextSpy;

  beforeEach(() => {
    jsonSpy = jest.fn();
    statusSpy = jest.fn().mockReturnValue({ json: jsonSpy });
    nextSpy = jest.fn();

    mockRequest = {
      ip: '127.0.0.1'
    };

    mockResponse = {
      status: statusSpy,
      json: jsonSpy
    };

    jest.clearAllMocks();
  });

  it('should create rate limiter with default values', () => {
    const middleware = rateLimiterMiddleware();

    expect(rateLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        windowMs: 60 * 1000, // 1 minute
        max: 100,
        standardHeaders: true,
        legacyHeaders: false
      })
    );
  });

  it('should create rate limiter with custom maxRequests and windowMinutes', () => {
    const middleware = rateLimiterMiddleware(50, 5);

    expect(rateLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        windowMs: 5 * 60 * 1000, // 5 minutes
        max: 50
      })
    );
  });

  it('should have correct message in default configuration', () => {
    const middleware = rateLimiterMiddleware();
    const config = rateLimit.mock.calls[0][0];

    expect(config.message).toEqual({
      error: 'Too many requests',
      message: 'Please try again later.',
      retryAfter: 60
    });
  });

  it('should have correct message with custom windowMinutes', () => {
    const middleware = rateLimiterMiddleware(100, 10);
    const config = rateLimit.mock.calls[0][0];

    expect(config.message).toEqual({
      error: 'Too many requests',
      message: 'Please try again later.',
      retryAfter: 600 // 10 minutes in seconds
    });
  });

  it('should call handler with correct response when rate limit is exceeded', () => {
    const middleware = rateLimiterMiddleware(100, 1);
    const config = rateLimit.mock.calls[0][0];

    // Call the handler directly to test it
    config.handler(mockRequest, mockResponse);

    expect(statusSpy).toHaveBeenCalledWith(429);
    expect(jsonSpy).toHaveBeenCalledWith({
      error: 'Rate limit exceeded',
      message: 'Maximum 100 requests per 1 minute(s) allowed',
      retryAfter: 60
    });
  });

  it('should use custom maxRequests in handler message', () => {
    const middleware = rateLimiterMiddleware(200, 2);
    const config = rateLimit.mock.calls[0][0];

    config.handler(mockRequest, mockResponse);

    expect(jsonSpy).toHaveBeenCalledWith({
      error: 'Rate limit exceeded',
      message: 'Maximum 200 requests per 2 minute(s) allowed',
      retryAfter: 120
    });
  });

  it('should return middleware function', () => {
    const middleware = rateLimiterMiddleware();

    expect(typeof middleware).toBe('function');
    expect(middleware.length).toBe(3); // Express middleware signature: (req, res, next)
  });

  it('should configure standardHeaders and legacyHeaders correctly', () => {
    const middleware = rateLimiterMiddleware();
    const config = rateLimit.mock.calls[0][0];

    expect(config.standardHeaders).toBe(true);
    expect(config.legacyHeaders).toBe(false);
  });
});

