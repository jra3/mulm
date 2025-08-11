import rateLimit from 'express-rate-limit';
import { MulmRequest } from '../sessions';
import { logger } from '../utils/logger';

// Helper function to properly handle IPv6 addresses
const getIpKey = (req: any): string => {
  // For IPv6, we need to handle the address properly to prevent bypass
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  // Normalize IPv6 addresses (e.g., ::1 becomes 127.0.0.1)
  if (ip.includes(':')) {
    // For IPv6, use the first 64 bits (4 groups) to group by subnet
    const parts = ip.split(':').slice(0, 4);
    return parts.join(':');
  }
  return ip;
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
  handler: (req, res) => {
    const mulmReq = req as MulmRequest;
    logger.warn('Rate limit exceeded for upload', {
      viewer: mulmReq.viewer?.id,
      ip: req.ip,
      path: req.path
    });
    res.status(429).json({
      error: 'Too many upload requests',
      message: 'Please wait a moment before uploading more images. You can upload up to 10 images per minute.',
      retryAfter: res.getHeader('Retry-After')
    });
  },
  skip: (req: MulmRequest) => {
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
  handler: (req, res) => {
    const mulmReq = req as MulmRequest;
    logger.warn('Rate limit exceeded for delete', {
      viewer: mulmReq.viewer?.id,
      ip: req.ip,
      path: req.path
    });
    res.status(429).json({
      error: 'Too many delete requests',
      message: 'Please wait before deleting more images.',
      retryAfter: res.getHeader('Retry-After')
    });
  },
  skip: (req: MulmRequest) => {
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
  handler: (req, res) => {
    const mulmReq = req as MulmRequest;
    logger.warn('Rate limit exceeded for progress polling', {
      viewer: mulmReq.viewer?.id,
      ip: req.ip,
      uploadId: req.params.uploadId
    });
    // For SSE, just close the connection
    res.status(429).end();
  },
  skip: (req: MulmRequest) => {
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
  handler: (req, res) => {
    logger.warn('Unauthenticated rate limit exceeded', {
      ip: req.ip,
      path: req.path
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
  handler: (req, res) => {
    const mulmReq = req as MulmRequest;
    logger.warn('Daily rate limit exceeded', {
      viewer: mulmReq.viewer?.id,
      ip: req.ip
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