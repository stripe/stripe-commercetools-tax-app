import rateLimit from 'express-rate-limit';

/**
 * Rate limiter middleware to protect endpoints from abuse
 * @param {number} maxRequests - Maximum number of requests
 * @param {number} windowMinutes - Time window in minutes
 * @returns {Function} Express middleware
 */
export const rateLimiterMiddleware = (maxRequests = 100, windowMinutes = 1) => {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max: maxRequests,
    message: {
      error: 'Too many requests',
      message: 'Please try again later.',
      retryAfter: windowMinutes * 60,
    },
    standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
    legacyHeaders: false, // Don't use `X-RateLimit-*` headers
    // Custom handler for errors
    handler: (req, res) => {
      res.status(429).json({
        error: 'Rate limit exceeded',
        message: `Maximum ${maxRequests} requests per ${windowMinutes} minute(s) allowed`,
        retryAfter: windowMinutes * 60,
      });
    },
  });
};
