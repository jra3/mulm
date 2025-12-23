/**
 * GBIF (Global Biodiversity Information Facility) Integration Client
 *
 * Client for integrating with GBIF API to fetch:
 * - Species occurrence data and distribution maps
 * - Specimen photographs
 * - Taxonomic information
 * - Species page URLs
 *
 * API Documentation: https://www.gbif.org/developer/summary
 * No authentication required for read-only access
 */

import config from "@/config.json";
import { logger } from "@/utils/logger";
import {
  BaseIntegrationClient,
  type IntegrationClientConfig,
} from "./base-integration-client";

/**
 * GBIF Species Match Response
 */
export interface GBIFSpeciesMatch {
  usageKey: number; // GBIF taxon key
  scientificName: string;
  canonicalName: string;
  rank: string; // SPECIES, GENUS, etc.
  status: string; // ACCEPTED, SYNONYM, etc.
  confidence: number; // 0-100
  matchType: string; // EXACT, FUZZY, etc.
  kingdom?: string;
  phylum?: string;
  class?: string;
  order?: string;
  family?: string;
  genus?: string;
  species?: string;
  kingdomKey?: number;
  phylumKey?: number;
  classKey?: number;
  orderKey?: number;
  familyKey?: number;
  genusKey?: number;
  speciesKey?: number;
}

/**
 * GBIF Species Detail
 */
export interface GBIFSpeciesDetail {
  key: number;
  scientificName: string;
  canonicalName: string;
  rank: string;
  status: string;
  kingdom?: string;
  phylum?: string;
  class?: string;
  order?: string;
  family?: string;
  genus?: string;
  species?: string;
  vernacularNames?: Array<{
    vernacularName: string;
    language: string;
  }>;
  descriptions?: Array<{
    description: string;
    language: string;
    type: string;
  }>;
}

/**
 * GBIF Media Item (images, sounds, videos)
 */
export interface GBIFMedia {
  type: string; // StillImage, MovingImage, Sound
  format: string; // image/jpeg, etc.
  identifier: string; // URL to media file
  references?: string; // Source URL
  title?: string;
  description?: string;
  created?: string;
  creator?: string;
  publisher?: string;
  license?: string;
  rightsHolder?: string;
}

/**
 * GBIF Media Search Response
 */
export interface GBIFMediaResponse {
  offset: number;
  limit: number;
  endOfRecords: boolean;
  results: GBIFMedia[];
}

/**
 * Result from GBIF integration
 */
export interface GBIFResult {
  usageKey: number;
  gbifUrl: string;
  occurrenceMapUrl: string;
  imageUrls: string[];
  scientificName: string;
  confidence: number;
}

/**
 * GBIF Client
 *
 * Provides methods to query GBIF API for species data, occurrence maps, and images
 */
export class GBIFClient extends BaseIntegrationClient {
  protected serviceName = "GBIF";

  constructor(clientConfig?: Partial<IntegrationClientConfig>) {
    const defaultConfig = config.gbif;

    if (!defaultConfig) {
      throw new Error("GBIF configuration not found in config.json");
    }

    // Map config field names to match IntegrationClientConfig
    const integrationConfig: IntegrationClientConfig = {
      baseUrl: defaultConfig.baseUrl,
      rateLimitMs: defaultConfig.rateLimitMs,
      maxRetries: defaultConfig.maxRetries,
      timeoutMs: defaultConfig.timeoutMs,
      enabled: defaultConfig.enableSync,
    };

    super({
      ...integrationConfig,
      ...clientConfig,
    });

    this.logInit();
  }

  /**
   * Match a species name to get GBIF usage key
   *
   * @param genus - Genus name
   * @param species - Species epithet
   * @returns Species match data or null if not found
   */
  async matchSpecies(genus: string, species: string): Promise<GBIFSpeciesMatch | null> {
    if (!this.isEnabled()) {
      logger.warn("GBIF integration is disabled");
      return null;
    }

    try {
      const scientificName = `${genus} ${species}`;
      const response = await this.get<GBIFSpeciesMatch>("/species/match", {
        name: scientificName,
        verbose: false,
      });

      if (!response) {
        logger.info(`Species not found in GBIF: ${scientificName}`);
        return null;
      }

      // Check if we got a good match
      if (response.matchType === "NONE" || response.confidence < 80) {
        logger.info(
          `Low confidence GBIF match for ${scientificName}: ${response.confidence}% (${response.matchType})`
        );
        return null;
      }

      return response;
    } catch (error) {
      logger.error(`Failed to match species in GBIF for ${genus} ${species}`, error);
      return null;
    }
  }

  /**
   * Get species detail by usage key
   *
   * @param usageKey - GBIF usage key
   * @returns Species detail or null if not found
   */
  async getSpeciesDetail(usageKey: number): Promise<GBIFSpeciesDetail | null> {
    if (!this.isEnabled()) {
      return null;
    }

    try {
      const response = await this.get<GBIFSpeciesDetail>(`/species/${usageKey}`);
      return response;
    } catch (error) {
      logger.error(`Failed to get GBIF species detail for key ${usageKey}`, error);
      return null;
    }
  }

  /**
   * Get media (images) for a species
   *
   * @param usageKey - GBIF usage key
   * @param limit - Maximum number of images to retrieve (default: 20)
   * @returns Media items
   */
  async getSpeciesMedia(usageKey: number, limit = 20): Promise<GBIFMedia[]> {
    if (!this.isEnabled()) {
      return [];
    }

    try {
      const response = await this.get<GBIFMediaResponse>(`/species/${usageKey}/media`, {
        limit,
      });

      if (!response || !response.results) {
        return [];
      }

      // Filter to only images (StillImage)
      const images = response.results.filter(
        (media) => media.type === "StillImage" && media.identifier
      );

      return images;
    } catch (error) {
      logger.error(`Failed to get GBIF media for key ${usageKey}`, error);
      return [];
    }
  }

  /**
   * Get external links and images for a species
   *
   * @param genus - Genus name
   * @param species - Species epithet
   * @returns External references and images, or null if not found
   */
  async getExternalData(genus: string, species: string): Promise<GBIFResult | null> {
    const match = await this.matchSpecies(genus, species);

    if (!match) {
      return null;
    }

    // Construct GBIF species page URL
    const gbifUrl = `https://www.gbif.org/species/${match.usageKey}`;

    // Construct occurrence map URL
    // This is a static map image showing where the species has been observed
    const occurrenceMapUrl = `https://api.gbif.org/v2/map/occurrence/density/0/0/0@1x.png?taxonKey=${match.usageKey}&bin=hex&hexPerTile=30&style=purpleYellow.point`;

    // Get images
    const media = await this.getSpeciesMedia(match.usageKey, 10);
    const imageUrls = media.map((m) => m.identifier).filter((url) => url && url.length > 0);

    return {
      usageKey: match.usageKey,
      gbifUrl,
      occurrenceMapUrl,
      imageUrls,
      scientificName: match.canonicalName || match.scientificName,
      confidence: match.confidence,
    };
  }

  /**
   * Test API connectivity
   *
   * @returns true if API is accessible
   */
  async testConnection(): Promise<boolean> {
    try {
      // Try to match a common, well-known species
      const result = await this.matchSpecies("Poecilia", "reticulata");
      if (!result) {
        logger.warn("GBIF test query returned no results");
        return false;
      }

      logger.info("GBIF API connection test successful");
      return true;
    } catch (error) {
      logger.error("GBIF API connection test failed", error);
      return false;
    }
  }
}

/**
 * Create a singleton GBIF client instance
 */
let clientInstance: GBIFClient | null = null;

/**
 * Get the GBIF client instance (singleton)
 */
export function getGBIFClient(): GBIFClient {
  if (!clientInstance) {
    if (!config.gbif?.enableSync) {
      throw new Error("GBIF integration is disabled in configuration");
    }
    clientInstance = new GBIFClient();
  }
  return clientInstance;
}

/**
 * For testing: reset the singleton instance
 */
export function resetGBIFClient(): void {
  clientInstance = null;
}
