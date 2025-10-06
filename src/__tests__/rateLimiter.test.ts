import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert';
import express, { Request, Response } from 'express';
import request from 'supertest';
import rateLimit, { Options } from 'express-rate-limit';
import { MulmRequest } from '../sessions';

// Create rate limiters with test configuration
const createTestRateLimiter = (options: Partial<Options>) => {
  return rateLimit({
    ...options as Options,
    skip: () => false, // Don't skip in tests
    store: undefined, // Use default memory store
    validate: false // Disable validation in tests to avoid IPv6 warnings
  });
};

describe('Rate Limiting Middleware', () => {
  let app: express.Application;
  let uploadRateLimiter: express.RequestHandler;
  let deleteRateLimiter: express.RequestHandler;
  let progressRateLimiter: express.RequestHandler;
  let strictUploadLimiter: express.RequestHandler;

  beforeEach(() => {
    app = express();
    app.set('trust proxy', true); // Trust x-forwarded-for headers

    // Create fresh rate limiters for each test
    uploadRateLimiter = createTestRateLimiter({
      windowMs: 60 * 1000,
      max: 10,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req: MulmRequest) => {
        return req.viewer?.id?.toString() || req.ip || 'test';
      },
      handler: (_req: Request, res: Response) => {
        res.status(429).json({
          error: 'Too many upload requests',
          message: 'Please wait a moment before uploading more images. You can upload up to 10 images per minute.',
          retryAfter: res.getHeader('Retry-After')
        });
      }
    });

    deleteRateLimiter = createTestRateLimiter({
      windowMs: 60 * 1000,
      max: 20,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req: MulmRequest) => {
        return req.viewer?.id?.toString() || req.ip || 'test';
      },
      handler: (_req: Request, res: Response) => {
        res.status(429).json({
          error: 'Too many delete requests',
          message: 'Please wait before deleting more images.',
          retryAfter: res.getHeader('Retry-After')
        });
      }
    });

    progressRateLimiter = createTestRateLimiter({
      windowMs: 60 * 1000,
      max: 60,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req: MulmRequest) => {
        const uploadId = req.params.uploadId;
        const userKey = req.viewer?.id?.toString() || req.ip || 'test';
        return `${uploadId}:${userKey}`;
      },
      handler: (_req: Request, res: Response) => {
        res.status(429).end();
      }
    });

    strictUploadLimiter = createTestRateLimiter({
      windowMs: 60 * 1000,
      max: 3,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req: Request) => req.ip || 'test',
      handler: (_req: Request, res: Response) => {
        res.status(429).json({
          error: 'Too many requests',
          message: 'Please sign in to upload more images.'
        });
      },
      skip: (req: MulmRequest) => !!req.viewer
    });
    
    // Mock viewer middleware
    app.use((req: MulmRequest, res, next) => {
      // Simulate authenticated user for some tests
      if (req.headers['x-auth'] === 'true') {
        // Generate unique user ID based on IP to isolate rate limit counters
        const forwardedFor = req.headers['x-forwarded-for'] as string;
        const ip = forwardedFor || req.ip || '127.0.0.1';
        const userId = parseInt(ip.split('.').join('').replace(/[^0-9]/g, '')) || 1;
        req.viewer = { id: userId, display_name: 'Test User', contact_email: 'test@example.com' };
      }
      next();
    });
  });

  describe('Upload Rate Limiter', () => {
    beforeEach(() => {
      app.post('/upload', uploadRateLimiter, (req, res) => {
        res.json({ success: true });
      });
    });

    test('should allow uploads within rate limit', async () => {
      // First 10 requests should succeed
      for (let i = 0; i < 10; i++) {
        const response = await request(app)
          .post('/upload')
          .set('x-auth', 'true')
          .expect(200);
        
        assert.deepStrictEqual(response.body, { success: true });
      }
    });

    test('should block uploads exceeding rate limit', async () => {
      // Make 10 successful requests
      for (let i = 0; i < 10; i++) {
        await request(app)
          .post('/upload')
          .set('x-auth', 'true')
          .expect(200);
      }

      // 11th request should be rate limited
      const response = await request(app)
        .post('/upload')
        .set('x-auth', 'true')
        .expect(429);

      assert.strictEqual((response.body as { error: string }).error, 'Too many upload requests');
      assert.ok((response.body as { message: string }).message.includes('10 images per minute'));
    });

    test('should track rate limits per user', async () => {
      // User 1 makes 10 requests
      for (let i = 0; i < 10; i++) {
        await request(app)
          .post('/upload')
          .set('x-auth', 'true')
          .set('x-forwarded-for', '1.1.1.1')
          .expect(200);
      }

      // User 1's 11th request should fail
      await request(app)
        .post('/upload')
        .set('x-auth', 'true')
        .set('x-forwarded-for', '1.1.1.1')
        .expect(429);

      // Different IP (unauthenticated) should still work
      await request(app)
        .post('/upload')
        .set('x-forwarded-for', '2.2.2.2')
        .expect(200);
    });
  });

  describe('Delete Rate Limiter', () => {
    beforeEach(() => {
      app.delete('/delete', deleteRateLimiter, (req, res) => {
        res.json({ success: true });
      });
    });

    test('should allow 20 deletes per minute', async () => {
      // First 20 requests should succeed
      for (let i = 0; i < 20; i++) {
        const response = await request(app)
          .delete('/delete')
          .set('x-auth', 'true')
          .expect(200);
        
        assert.deepStrictEqual(response.body, { success: true });
      }

      // 21st request should be rate limited
      const response = await request(app)
        .delete('/delete')
        .set('x-auth', 'true')
        .expect(429);

      assert.strictEqual((response.body as { error: string }).error, 'Too many delete requests');
    });
  });

  describe('Progress Rate Limiter', () => {
    beforeEach(() => {
      app.get('/progress/:uploadId', progressRateLimiter, (req, res) => {
        res.json({ uploadId: req.params.uploadId });
      });
    });

    test('should allow 60 progress checks per minute per upload', async () => {
      const uploadId = 'upload_123';
      
      // First 60 requests should succeed
      for (let i = 0; i < 60; i++) {
        const response = await request(app)
          .get(`/progress/${uploadId}`)
          .set('x-auth', 'true')
          .expect(200);

        assert.strictEqual((response.body as { uploadId: string }).uploadId, uploadId);
      }

      // 61st request should be rate limited
      await request(app)
        .get(`/progress/${uploadId}`)
        .set('x-auth', 'true')
        .expect(429);
    });

    test('should track progress limits per upload ID', async () => {
      // Upload 1 can make 60 requests
      for (let i = 0; i < 60; i++) {
        await request(app)
          .get('/progress/upload_1')
          .set('x-auth', 'true')
          .expect(200);
      }

      // Upload 2 should still work
      await request(app)
        .get('/progress/upload_2')
        .set('x-auth', 'true')
        .expect(200);
    });
  });

  describe('Strict Upload Limiter', () => {
    beforeEach(() => {
      app.post('/strict', strictUploadLimiter, (req, res) => {
        res.json({ success: true });
      });
    });

    test('should limit unauthenticated users to 3 uploads', async () => {
      // First 3 requests should succeed
      for (let i = 0; i < 3; i++) {
        await request(app)
          .post('/strict')
          .set('x-forwarded-for', '8.8.8.8')
          .expect(200);
      }

      // 4th request should be rate limited
      const response = await request(app)
        .post('/strict')
        .set('x-forwarded-for', '8.8.8.8')
        .expect(429);

      assert.strictEqual((response.body as { error: string }).error, 'Too many requests');
      assert.ok((response.body as { message: string }).message.includes('sign in'));
    });

    test('should not limit authenticated users', async () => {
      // Authenticated users can make more than 3 requests
      for (let i = 0; i < 10; i++) {
        await request(app)
          .post('/strict')
          .set('x-auth', 'true')
          .set('x-forwarded-for', '5.5.5.5')
          .expect(200);
      }
    });
  });

  describe('Combined Rate Limiters', () => {
    beforeEach(() => {
      // Apply limiters in order: strict first, then regular upload limiter
      app.post('/combined', strictUploadLimiter, uploadRateLimiter, (req, res) => {
        res.json({ success: true });
      });
    });

    test('should apply all rate limiters in order', async () => {
      // Unauthenticated user hits strict limit first (3 requests)
      for (let i = 0; i < 3; i++) {
        await request(app)
          .post('/combined')
          .set('x-forwarded-for', '9.9.9.9')
          .expect(200);
      }

      // 4th unauthenticated request should fail
      await request(app)
        .post('/combined')
        .set('x-forwarded-for', '9.9.9.9')
        .expect(429);

      // Authenticated user can make 10 requests
      for (let i = 0; i < 10; i++) {
        await request(app)
          .post('/combined')
          .set('x-auth', 'true')
          .set('x-forwarded-for', '4.4.4.4')
          .expect(200);
      }

      // 11th authenticated request should fail
      await request(app)
        .post('/combined')
        .set('x-auth', 'true')
        .set('x-forwarded-for', '4.4.4.4')
        .expect(429);
    });
  });

  describe('Rate Limiter Headers', () => {
    beforeEach(() => {
      app.post('/headers', uploadRateLimiter, (req, res) => {
        res.json({ success: true });
      });
    });

    test('should include rate limit headers', async () => {
      const response = await request(app)
        .post('/headers')
        .set('x-auth', 'true')
        .set('x-forwarded-for', '6.6.6.6')
        .expect(200);

      assert.strictEqual(response.headers['x-ratelimit-limit'], '10');
      assert.ok(response.headers['x-ratelimit-remaining'] !== undefined);
      assert.ok(response.headers['x-ratelimit-reset'] !== undefined);
    });

    test('should include retry-after header when rate limited', async () => {
      // Exhaust rate limit
      for (let i = 0; i < 10; i++) {
        await request(app)
          .post('/headers')
          .set('x-auth', 'true')
          .set('x-forwarded-for', '7.7.7.7');
      }

      const response = await request(app)
        .post('/headers')
        .set('x-auth', 'true')
        .set('x-forwarded-for', '7.7.7.7')
        .expect(429);

      assert.ok(response.headers['retry-after'] !== undefined);
      assert.ok((response.body as { retryAfter?: string }).retryAfter !== undefined);
    });
  });
});