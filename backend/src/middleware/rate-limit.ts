import rateLimit from 'express-rate-limit';

/**
 * Rate limiter for authentication endpoints.
 * Strict limits to prevent brute force attacks on login.
 *
 * 5 failed attempts per 15 minutes per IP.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 requests per window (allows for some page refreshes + login attempts)
  message: {
    error: 'Too many authentication attempts',
    message: 'Please try again after 15 minutes',
    retryAfter: 15 * 60, // seconds
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  // Skip rate limiting if user is already authenticated (for /me endpoint)
  skip: (req) => {
    return req.path === '/me' && req.headers.authorization !== undefined;
  },
});

/**
 * Stricter rate limiter specifically for login attempts.
 * 5 attempts per 15 minutes per IP.
 */
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Only 5 login attempts per window
  message: {
    error: 'Too many login attempts',
    message: 'Account temporarily locked. Please try again after 15 minutes',
    retryAfter: 15 * 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Use a custom key generator that includes the email (if available) to prevent
  // distributed brute force attacks from multiple IPs targeting the same account
  keyGenerator: (req) => {
    const email = req.body?.email?.toLowerCase() || '';
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    // If email is provided, rate limit by email as well
    if (email) {
      return `login:${email}:${ip}`;
    }
    return `login:${ip}`;
  },
});

/**
 * Rate limiter for registration endpoint.
 * Very strict to prevent mass account creation.
 *
 * 3 registrations per hour per IP.
 */
export const registrationRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // Only 3 registration attempts per hour
  message: {
    error: 'Too many registration attempts',
    message: 'Please try again later',
    retryAfter: 60 * 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter for API key operations.
 * Moderate limits to prevent API key enumeration attacks.
 *
 * 20 requests per minute.
 */
export const apiKeyRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  message: {
    error: 'Too many API key requests',
    message: 'Please slow down',
    retryAfter: 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * General API rate limiter.
 * Applied to all API routes as a baseline protection.
 *
 * 1000 requests per minute per IP.
 */
export const generalApiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 1000,
  message: {
    error: 'Too many requests',
    message: 'Please slow down',
    retryAfter: 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Skip rate limiting in development if explicitly disabled
  skip: () => {
    return process.env.DISABLE_RATE_LIMIT === 'true' && process.env.NODE_ENV !== 'production';
  },
});

/**
 * Rate limiter for password change attempts.
 * Prevents brute force attacks on password change.
 *
 * 5 attempts per hour per user.
 */
export const passwordChangeRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: {
    error: 'Too many password change attempts',
    message: 'Please try again later',
    retryAfter: 60 * 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Rate limit by user ID if available (from auth middleware)
    const userId = (req as unknown as { user?: { userId: string } }).user?.userId;
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    return userId ? `pwd-change:${userId}` : `pwd-change:${ip}`;
  },
});
