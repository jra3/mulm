/**
 * IUCN Red List API Client
 *
 * Client for interacting with the IUCN Red List API v3 to fetch conservation status data.
 *
 * API Documentation: https://api.iucnredlist.org/api-docs/
 * Terms of Use: https://www.iucnredlist.org/terms/terms-of-use
 *
 * Rate Limiting: IUCN requests 2-second delay between API calls
 * Authentication: Requires API token (obtain from https://apiv3.iucnredlist.org/api/v3/token)
 */

import config from "@/config.json";
import { logger } from "@/utils/logger";

// IUCN Red List conservation categories
export type IUCNCategory = "EX" | "EW" | "CR" | "EN" | "VU" | "NT" | "LC" | "DD" | "NE";

// Population trend directions
export type PopulationTrend = "Increasing" | "Decreasing" | "Stable" | "Unknown";

/**
 * IUCN API Species Response
 * Based on IUCN Red List API v3 response structure
 */
export interface IUCNSpeciesResult {
  taxonid: number; // IUCN taxon identifier
  scientific_name: string; // Scientific name
  kingdom: string; // Kingdom (usually "ANIMALIA")
  phylum: string; // Phylum
  class: string; // Class
  order: string; // Order
  family: string; // Family name
  genus: string; // Genus
  main_common_name?: string; // Primary common name
  authority?: string; // Taxonomic authority
  published_year?: number; // Year of assessment publication
  assessment_date?: string; // Date of assessment
  category: IUCNCategory; // Conservation status category
  criteria?: string; // IUCN criteria used
  population_trend?: PopulationTrend; // Population trend
  marine_system?: boolean; // Found in marine systems
  freshwater_system?: boolean; // Found in freshwater
  terrestrial_system?: boolean; // Found on land
}

/**
 * IUCN API Response Wrapper
 */
export interface IUCNAPIResponse {
  name: string; // Searched name
  result: IUCNSpeciesResult[];
}

/**
 * IUCN API Error Response
 */
export interface IUCNErrorResponse {
  message?: string;
}

/**
 * Configuration for IUCN Client
 */
export interface IUCNClientConfig {
  apiToken: string;
  baseUrl: string;
  rateLimitMs: number;
  maxRetries: number;
  timeoutMs: number;
  enableSync: boolean;
}

/**
 * IUCN API Client Error
 */
export class IUCNAPIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public response?: unknown
  ) {
    super(message);
    this.name = "IUCNAPIError";
  }
}

/**
 * Delay utility for rate limiting
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * IUCN Red List API Client
 *
 * Provides methods to query the IUCN Red List API with proper rate limiting,
 * error handling, and retry logic.
 */
export class IUCNClient {
  private config: IUCNClientConfig;
  private lastRequestTime = 0;

  constructor(clientConfig?: Partial<IUCNClientConfig>) {
    // Load configuration from config.json and merge with overrides
    const defaultConfig = config.iucn;

    if (!defaultConfig || !defaultConfig.apiToken) {
      throw new Error("IUCN configuration not found in config.json");
    }

    this.config = {
      ...defaultConfig,
      ...clientConfig,
    };

    if (this.config.apiToken === "YOUR_IUCN_API_TOKEN_HERE") {
      throw new Error("IUCN API token not configured. Please add your token to config.json");
    }

    logger.info("IUCN API client initialized");
  }

  /**
   * Enforce rate limiting by waiting if necessary
   */
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.config.rateLimitMs) {
      const waitTime = this.config.rateLimitMs - timeSinceLastRequest;
      logger.info(`Rate limiting: waiting ${waitTime}ms`);
      await delay(waitTime);
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Make a request to the IUCN API with retry logic
   */
  private async request<T>(
    endpoint: string,
    retryCount = 0
  ): Promise<T | null> {
    await this.enforceRateLimit();

    const url = `${this.config.baseUrl}${endpoint}`;
    const urlWithToken = `${url}${endpoint.includes("?") ? "&" : "?"}token=${this.config.apiToken}`;

    logger.info(`IUCN API request: ${endpoint}`);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

      const response = await fetch(urlWithToken, {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
        },
      });

      clearTimeout(timeout);

      // Handle different status codes
      if (response.status === 404) {
        logger.info(`IUCN API: Species not found (404)`);
        return null;
      }

      if (response.status === 429) {
        // Rate limited
        if (retryCount < this.config.maxRetries) {
          const backoffMs = this.config.rateLimitMs * Math.pow(2, retryCount);
          logger.warn(`IUCN API rate limited. Retrying in ${backoffMs}ms (attempt ${retryCount + 1})`);
          await delay(backoffMs);
          return this.request<T>(endpoint, retryCount + 1);
        } else {
          throw new IUCNAPIError("Rate limit exceeded after retries", 429);
        }
      }

      if (response.status === 401) {
        throw new IUCNAPIError("Invalid API token", 401);
      }

      if (!response.ok) {
        const errorBody = await response.text();
        throw new IUCNAPIError(
          `HTTP ${response.status}: ${errorBody}`,
          response.status,
          errorBody
        );
      }

      const data = (await response.json()) as T;
      return data;
    } catch (error) {
      if (error instanceof IUCNAPIError) {
        throw error;
      }

      if ((error as Error).name === "AbortError") {
        throw new IUCNAPIError("Request timeout", undefined);
      }

      // Network or other fetch errors
      if (retryCount < this.config.maxRetries) {
        const backoffMs = this.config.rateLimitMs * Math.pow(2, retryCount);
        logger.warn(`IUCN API error. Retrying in ${backoffMs}ms (attempt ${retryCount + 1})`);
        await delay(backoffMs);
        return this.request<T>(endpoint, retryCount + 1);
      }

      throw new IUCNAPIError(`Request failed: ${(error as Error).message}`);
    }
  }

  /**
   * Get species information by scientific name
   *
   * @param scientificName - Full scientific name (e.g., "Panthera tigris")
   * @returns Species data or null if not found
   *
   * Note: The API may support both formats:
   * - /species/{scientific_name} (full binomial)
   * - /species/genus/{genus}/species/{species}
   *
   * We'll try the simpler format first and adjust based on testing.
   */
  async getSpeciesByName(scientificName: string): Promise<IUCNSpeciesResult | null> {
    const encodedName = encodeURIComponent(scientificName);
    const response = await this.request<IUCNAPIResponse>(`/species/${encodedName}`);

    if (!response || !response.result || response.result.length === 0) {
      return null;
    }

    return response.result[0];
  }

  /**
   * Get species information by genus and species name
   *
   * @param genus - Genus name
   * @param species - Species epithet
   * @returns Species data or null if not found
   */
  async getSpecies(genus: string, species: string): Promise<IUCNSpeciesResult | null> {
    const scientificName = `${genus} ${species}`;
    return this.getSpeciesByName(scientificName);
  }

  /**
   * Check if a name is a synonym and get the accepted name
   *
   * @param scientificName - Scientific name to check
   * @returns Synonym information or null if not found
   */
  async checkSynonym(scientificName: string): Promise<IUCNSpeciesResult | null> {
    const encodedName = encodeURIComponent(scientificName);
    const response = await this.request<IUCNAPIResponse>(`/species/synonym/${encodedName}`);

    if (!response || !response.result || response.result.length === 0) {
      return null;
    }

    return response.result[0];
  }

  /**
   * Get species by IUCN ID
   *
   * @param taxonId - IUCN taxon identifier
   * @returns Species data or null if not found
   */
  async getSpeciesById(taxonId: number): Promise<IUCNSpeciesResult | null> {
    const response = await this.request<IUCNAPIResponse>(`/species/id/${taxonId}`);

    if (!response || !response.result || response.result.length === 0) {
      return null;
    }

    return response.result[0];
  }

  /**
   * Test API connectivity and token validity
   *
   * @returns true if API is accessible and token is valid
   */
  async testConnection(): Promise<boolean> {
    try {
      // Try a known species as a connectivity test
      await this.request<IUCNAPIResponse>("/version");
      return true;
    } catch (error) {
      logger.error("IUCN API connection test failed", error);
      return false;
    }
  }
}

/**
 * Create a singleton IUCN client instance
 */
let clientInstance: IUCNClient | null = null;

/**
 * Get the IUCN client instance (singleton)
 */
export function getIUCNClient(): IUCNClient {
  if (!clientInstance) {
    if (!config.iucn?.enableSync) {
      throw new Error("IUCN integration is disabled in configuration");
    }
    clientInstance = new IUCNClient();
  }
  return clientInstance;
}

/**
 * For testing: reset the singleton instance
 */
export function resetIUCNClient(): void {
  clientInstance = null;
}
