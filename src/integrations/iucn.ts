/**
 * IUCN Red List API Client
 *
 * Client for interacting with the IUCN Red List API v4 to fetch conservation status data.
 *
 * API Documentation: https://api.iucnredlist.org/api-docs/
 * Terms of Use: https://www.iucnredlist.org/terms/terms-of-use
 *
 * Rate Limiting: IUCN requests 2-second delay between API calls
 * Authentication: Requires Bearer token in Authorization header (obtain from https://api.iucnredlist.org/)
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
  url?: string; // Direct URL to IUCN Red List species page
}

/**
 * IUCN API Response Wrapper (v3 - deprecated)
 */
export interface IUCNAPIResponse {
  name: string; // Searched name
  result: IUCNSpeciesResult[];
}

/**
 * IUCN API v4 Assessment Response
 */
export interface IUCNV4Assessment {
  assessment_id: number;
  year_published: string;
  latest: boolean;
  red_list_category_code: IUCNCategory;
  url: string;
  taxon_scientific_name: string;
  possibly_extinct?: boolean;
  possibly_extinct_in_the_wild?: boolean;
}

/**
 * IUCN API v4 Taxon Response
 */
export interface IUCNV4TaxonResponse {
  taxon: {
    sis_id: number;
    scientific_name: string;
    genus_name: string;
    species_name: string;
    kingdom_name: string;
    phylum_name: string;
    class_name: string;
    order_name: string;
    family_name: string;
    authority?: string;
    common_names?: Array<{
      name: string;
      language: string;
      main: boolean;
    }>;
  };
  assessments: IUCNV4Assessment[];
  params: {
    genus_name: string;
    species_name: string;
  };
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

    logger.info(`IUCN API request: ${endpoint}`);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.config.apiToken}`,
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
   * Note: v4 API uses /taxa/scientific_name?genus_name={genus}&species_name={species}
   */
  async getSpeciesByName(scientificName: string): Promise<IUCNSpeciesResult | null> {
    const parts = scientificName.trim().split(/\s+/);
    if (parts.length < 2) {
      logger.warn(`Invalid scientific name format: ${scientificName}`);
      return null;
    }

    const genus = parts[0];
    const species = parts[1];

    return this.getSpecies(genus, species);
  }

  /**
   * Get species information by genus and species name
   *
   * @param genus - Genus name
   * @param species - Species epithet
   * @returns Species data or null if not found
   */
  async getSpecies(genus: string, species: string): Promise<IUCNSpeciesResult | null> {
    const encodedGenus = encodeURIComponent(genus);
    const encodedSpecies = encodeURIComponent(species);
    const response = await this.request<IUCNV4TaxonResponse>(
      `/taxa/scientific_name?genus_name=${encodedGenus}&species_name=${encodedSpecies}`
    );

    if (!response || !response.assessments || response.assessments.length === 0) {
      return null;
    }

    // Get the latest assessment
    const latestAssessment = response.assessments.find((a) => a.latest);
    if (!latestAssessment) {
      return null;
    }

    // Convert v4 response to v3-compatible format for backward compatibility
    return {
      taxonid: response.taxon.sis_id,
      scientific_name: response.taxon.scientific_name,
      kingdom: response.taxon.kingdom_name,
      phylum: response.taxon.phylum_name,
      class: response.taxon.class_name,
      order: response.taxon.order_name,
      family: response.taxon.family_name,
      genus: response.taxon.genus_name,
      main_common_name: response.taxon.common_names?.find((n) => n.main)?.name,
      authority: response.taxon.authority,
      category: latestAssessment.red_list_category_code,
      url: latestAssessment.url, // Direct link to IUCN species page
      population_trend: undefined, // v4 API doesn't include this in basic query
      marine_system: undefined,
      freshwater_system: undefined,
      terrestrial_system: undefined,
    };
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
