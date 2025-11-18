/**
 * Base Integration Client
 *
 * Reusable base class for external API integrations with:
 * - Rate limiting
 * - Retry logic with exponential backoff
 * - Error handling
 * - Timeout management
 * - Request logging
 */

import { logger } from "@/utils/logger";

/**
 * Configuration for integration client
 */
export interface IntegrationClientConfig {
  baseUrl: string;
  rateLimitMs: number;
  maxRetries: number;
  timeoutMs: number;
  enabled: boolean;
  headers?: Record<string, string>;
}

/**
 * Integration API Error
 */
export class IntegrationAPIError extends Error {
  constructor(
    message: string,
    public serviceName: string,
    public statusCode?: number,
    public response?: unknown
  ) {
    super(message);
    this.name = "IntegrationAPIError";
  }
}

/**
 * Delay utility for rate limiting
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Base class for external API integrations
 *
 * Provides common functionality for rate limiting, retries, and error handling.
 * Extend this class to create specific integration clients.
 */
export abstract class BaseIntegrationClient {
  protected config: IntegrationClientConfig;
  protected lastRequestTime = 0;
  protected abstract serviceName: string;

  constructor(config: IntegrationClientConfig) {
    this.config = config;

    if (!this.config.enabled) {
      logger.info(`${this.serviceName} integration is disabled`);
    } else {
      logger.info(`${this.serviceName} integration client initialized`);
    }
  }

  /**
   * Check if this integration is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Enforce rate limiting by waiting if necessary
   */
  protected async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.config.rateLimitMs) {
      const waitTime = this.config.rateLimitMs - timeSinceLastRequest;
      logger.info(`${this.serviceName} rate limiting: waiting ${waitTime}ms`);
      await delay(waitTime);
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Make a GET request to the API with retry logic
   */
  protected async get<T>(
    endpoint: string,
    queryParams?: Record<string, string | number | boolean>,
    retryCount = 0
  ): Promise<T | null> {
    await this.enforceRateLimit();

    // Build URL with query parameters
    let url = `${this.config.baseUrl}${endpoint}`;
    if (queryParams) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(queryParams)) {
        params.append(key, String(value));
      }
      url += `?${params.toString()}`;
    }

    logger.info(`${this.serviceName} API request: ${endpoint}`);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          ...this.config.headers,
        },
      });

      clearTimeout(timeout);

      // Handle different status codes
      if (response.status === 404) {
        logger.info(`${this.serviceName} API: Not found (404)`);
        return null;
      }

      if (response.status === 429) {
        // Rate limited
        if (retryCount < this.config.maxRetries) {
          const backoffMs = this.config.rateLimitMs * Math.pow(2, retryCount);
          logger.warn(
            `${this.serviceName} API rate limited. Retrying in ${backoffMs}ms (attempt ${retryCount + 1})`
          );
          await delay(backoffMs);
          return this.get<T>(endpoint, queryParams, retryCount + 1);
        } else {
          throw new IntegrationAPIError(
            "Rate limit exceeded after retries",
            this.serviceName,
            429
          );
        }
      }

      if (response.status === 401 || response.status === 403) {
        throw new IntegrationAPIError(
          "Authentication failed",
          this.serviceName,
          response.status
        );
      }

      if (!response.ok) {
        const errorBody = await response.text();
        throw new IntegrationAPIError(
          `HTTP ${response.status}: ${errorBody}`,
          this.serviceName,
          response.status,
          errorBody
        );
      }

      const data = (await response.json()) as T;
      return data;
    } catch (error) {
      if (error instanceof IntegrationAPIError) {
        throw error;
      }

      if ((error as Error).name === "AbortError") {
        throw new IntegrationAPIError(
          "Request timeout",
          this.serviceName,
          undefined
        );
      }

      // Network or other fetch errors
      if (retryCount < this.config.maxRetries) {
        const backoffMs = this.config.rateLimitMs * Math.pow(2, retryCount);
        logger.warn(
          `${this.serviceName} API error. Retrying in ${backoffMs}ms (attempt ${retryCount + 1})`
        );
        await delay(backoffMs);
        return this.get<T>(endpoint, queryParams, retryCount + 1);
      }

      throw new IntegrationAPIError(
        `Request failed: ${(error as Error).message}`,
        this.serviceName
      );
    }
  }

  /**
   * Test API connectivity
   *
   * Override this in subclasses to implement service-specific connectivity tests
   */
  abstract testConnection(): Promise<boolean>;
}
