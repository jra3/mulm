import { Request } from 'express';
import rateLimit from 'express-rate-limit';
import { MulmRequest } from '../sessions';
import { logger } from '../utils/logger';

// Helper function to properly handle IPv6 addresses
const getIpKey = (req: Request): string => {
  // For IPv6, we need to handle the address properly to prevent bypass
  const socket = req.socket as { remoteAddress?: string };
  const ip = req.ip || socket?.remoteAddress || 'unknown';
  // Normalize IPv6 addresses (e.g., ::1 becomes 127.0.0.1)
  if (ip && typeof ip === 'string' && ip.includes(':')) {
    // For IPv6, use the first 64 bits (4 groups) to group by subnet
    const parts = ip.split(':').slice(0, 4);
    return parts.join(':');
  }
  return ip || 'unknown';
};

/**
 * Rate limiter for image upload endpoints
 * Limits authenticated users to 10 uploads per minute
 */
export const uploadRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 10, // 10 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: MulmRequest) => {
    // Use viewer ID for authenticated users, IP as fallback
    return req.viewer?.id?.toString() || getIpKey(req);
  },
  handler: (_req, res) => {
    const mulmReq = _req as MulmRequest;
    logger.warn('Rate limit exceeded for upload', {
      viewer: mulmReq.viewer?.id,
      ip: _req.ip,
      path: _req.path
    });
    res.status(429).json({
      error: 'Too many upload requests',
      message: 'Please wait a moment before uploading more images. You can upload up to 10 images per minute.',
      retryAfter: res.getHeader('Retry-After')
    });
  },
  skip: () => {
    // Skip rate limiting in test environment
    return process.env.NODE_ENV === 'test';
  }
});

/**
 * Rate limiter for image delete endpoints
 * More lenient as delete operations are less resource-intensive
 */
export const deleteRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 20, // 20 deletes per minute
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: MulmRequest) => {
    return req.viewer?.id?.toString() || getIpKey(req);
  },
  handler: (_req, res) => {
    const mulmReq = _req as MulmRequest;
    logger.warn('Rate limit exceeded for delete', {
      viewer: mulmReq.viewer?.id,
      ip: _req.ip,
      path: _req.path
    });
    res.status(429).json({
      error: 'Too many delete requests',
      message: 'Please wait before deleting more images.',
      retryAfter: res.getHeader('Retry-After')
    });
  },
  skip: () => {
    return process.env.NODE_ENV === 'test';
  }
});

/**
 * Rate limiter for progress polling endpoint
 * Allows frequent polling but prevents abuse
 */
export const progressRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 60, // 60 requests per minute (1 per second)
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: MulmRequest) => {
    // Key by upload ID + viewer/IP to allow multiple concurrent uploads
    const uploadId = req.params.uploadId;
    const userKey = req.viewer?.id?.toString() || getIpKey(req);
    return `${uploadId}:${userKey}`;
  },
  handler: (_req, res) => {
    const mulmReq = _req as MulmRequest;
    logger.warn('Rate limit exceeded for progress polling', {
      viewer: mulmReq.viewer?.id,
      ip: _req.ip,
      uploadId: _req.params.uploadId
    });
    // For SSE, just close the connection
    res.status(429).end();
  },
  skip: () => {
    return process.env.NODE_ENV === 'test';
  }
});

/**
 * Strict rate limiter for unauthenticated users
 * Applied globally to upload endpoints
 */
export const strictUploadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 3, // Only 3 requests for unauthenticated users
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getIpKey(req),
  handler: (_req, res) => {
    logger.warn('Unauthenticated rate limit exceeded', {
      ip: _req.ip,
      path: _req.path
    });
    res.status(429).json({
      error: 'Too many requests',
      message: 'Please sign in to upload more images.'
    });
  },
  skip: (req: MulmRequest) => {
    // Skip for authenticated users or in test environment
    return !!req.viewer || process.env.NODE_ENV === 'test';
  }
});

/**
 * Daily upload limit for authenticated users
 * Prevents abuse over longer time periods
 */
export const dailyUploadLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 500, // 500 uploads per day
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: MulmRequest) => {
    return req.viewer?.id?.toString() || getIpKey(req);
  },
  handler: (_req, res) => {
    const mulmReq = _req as MulmRequest;
    logger.warn('Daily rate limit exceeded', {
      viewer: mulmReq.viewer?.id,
      ip: _req.ip
    });
    res.status(429).json({
      error: 'Daily upload limit exceeded',
      message: 'You have reached your daily upload limit of 500 images. Please try again tomorrow.',
      retryAfter: res.getHeader('Retry-After')
    });
  },
  skip: (req: MulmRequest) => {
    // Only apply to authenticated users, skip in test
    return !req.viewer || process.env.NODE_ENV === 'test';
  }
});

/**
 * Apply all rate limiters to upload routes
 * Returns an array of middleware to apply in order
 */
export function getUploadRateLimiters() {
  return [
    strictUploadLimiter,   // First check unauthenticated limits
    uploadRateLimiter,      // Then check per-minute limits
    dailyUploadLimiter      // Finally check daily limits
  ];
}

/**
 * Rate limiter for login endpoint
 * Prevents brute force password attacks
 */
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Rate limit by IP + email to prevent targeted attacks
    const email = (req.body as { email?: string }).email || 'unknown';
    return `${getIpKey(req)}:${email}`;
  },
  handler: (_req, res) => {
    logger.warn('Login rate limit exceeded', {
      ip: _req.ip,
      email: (_req.body as { email?: string }).email
    });
    res.status(429).send('Too many login attempts. Please wait 15 minutes before trying again.');
  },
  skip: () => process.env.NODE_ENV === 'test'
});

/**
 * Rate limiter for signup endpoint
 * Prevents mass account creation
 */
export const signupRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 signups per hour per IP
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getIpKey(req),
  handler: (_req, res) => {
    logger.warn('Signup rate limit exceeded', {
      ip: _req.ip
    });
    res.status(429).send('Too many signup attempts. Please wait an hour before trying again.');
  },
  skip: () => process.env.NODE_ENV === 'test'
});

/**
 * Rate limiter for forgot password endpoint
 * Prevents email spam and enumeration
 */
export const forgotPasswordRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 password reset requests per hour per IP
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getIpKey(req),
  handler: (_req, res) => {
    logger.warn('Forgot password rate limit exceeded', {
      ip: _req.ip
    });
    res.status(429).send('Too many password reset requests. Please wait an hour before trying again.');
  },
  skip: () => process.env.NODE_ENV === 'test'
});

/**
 * Rate limiter for OAuth callback
 * Prevents OAuth flow abuse
 */
export const oauthRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // 10 OAuth attempts per 5 minutes per IP
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getIpKey(req),
  handler: (_req, res) => {
    logger.warn('OAuth rate limit exceeded', {
      ip: _req.ip
    });
    res.status(429).send('Too many OAuth attempts. Please wait a few minutes before trying again.');
  },
  skip: () => process.env.NODE_ENV === 'test'
});