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
    keyGenerator: (req) => {
      // Try to get IP from Forwarded header (standardized)
      const forwarded = req.headers['forwarded'];
      if (forwarded) {
        // Parse Forwarded header: "for=192.0.2.60;proto=http;by=203.0.113.43"
        const forMatch = forwarded.match(/for=([^;,\s]+)/i);
        if (forMatch && forMatch[1]) {
          // Remove quotes and brackets if present
          return forMatch[1].replace(/^["[\]]+|["[\]]+$/g, '');
        }
      }
      // Fallback to X-Forwarded-For header
      const xForwardedFor = req.headers['x-forwarded-for'];
      if (xForwardedFor) {
        // X-Forwarded-For can contain multiple IPs, take the first one
        const ips = xForwardedFor.split(',').map(ip => ip.trim());
        return ips[0];
      }
      // Final fallback to req.ip
      return req.ip || req.socket.remoteAddress || 'unknown';
    },
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
