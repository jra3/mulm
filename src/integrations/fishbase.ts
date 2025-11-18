/**
 * FishBase Integration Client
 *
 * Client for integrating with FishBase data to fetch:
 * - Species page URLs
 * - Species images
 * - External references
 *
 * Uses the rfishbase API at https://fishbase.ropensci.org
 * API Documentation: https://ropensci.github.io/fishbaseapidocs/
 */

import config from "@/config.json";
import { logger } from "@/utils/logger";
import { BaseIntegrationClient, type IntegrationClientConfig } from "./base-integration-client";

/**
 * FishBase API species response
 */
export interface FishBaseSpeciesResponse {
  count: number;
  returned: number;
  error: null | string;
  data: FishBaseSpecies[];
}

/**
 * FishBase species data
 */
export interface FishBaseSpecies {
  SpecCode: number;
  Genus: string;
  Species: string;
  SpeciesRefNo: number;
  Author: string | null;
  FBname: string | null;
  PicPreferredName: string | null;
  PicPreferredNameM: string | null;
  PicPreferredNameF: string | null;
  PicPreferredNameJ: string | null;
  FamCode: number;
  Subfamily: string | null;
  GenCode: number;
  SubGenCode: number | null;
  BodyShapeI: string | null;
  Source: string | null;
  Remark: string | null;
  TaxIssue: number;
  Fresh: number;
  Brack: number;
  Saltwater: number;
  Land: number;
  SpeciesGroup: string | null;
  Length: number | null;
  CommonLength: number | null;
  Weight: number | null;
  Pic: string | null;
  PictureFemale: string | null;
  LarvaPic: string | null;
  EggPic: string | null;
}

/**
 * Result from FishBase integration
 */
export interface FishBaseResult {
  specCode: number;
  fishbaseUrl: string;
  imageUrls: string[];
  scientificName: string;
}

/**
 * FishBase Client
 *
 * Provides methods to query FishBase API and construct external links/images
 */
export class FishBaseClient extends BaseIntegrationClient {
  protected serviceName = "FishBase";

  constructor(clientConfig?: Partial<IntegrationClientConfig>) {
    const defaultConfig = config.fishbase;

    if (!defaultConfig) {
      throw new Error("FishBase configuration not found in config.json");
    }

    // Map config field names to match IntegrationClientConfig
    const integrationConfig: IntegrationClientConfig = {
      baseUrl: defaultConfig.baseUrl,
      rateLimitMs: defaultConfig.rateLimitMs,
      maxRetries: defaultConfig.maxRetries,
      timeoutMs: defaultConfig.timeoutMs,
      enabled: defaultConfig.enableSync, // Map enableSync to enabled
    };

    super({
      ...integrationConfig,
      ...clientConfig,
    });

    this.logInit();
  }

  /**
   * Get species data by genus and species name
   *
   * @param genus - Genus name
   * @param species - Species epithet
   * @returns Species data or null if not found
   */
  async getSpecies(genus: string, species: string): Promise<FishBaseSpecies | null> {
    if (!this.isEnabled()) {
      logger.warn("FishBase integration is disabled");
      return null;
    }

    try {
      const response = await this.get<FishBaseSpeciesResponse>("/species", {
        genus,
        species,
      });

      if (!response || response.error) {
        logger.warn(`FishBase API error: ${response?.error || "Unknown error"}`);
        return null;
      }

      if (response.count === 0 || response.data.length === 0) {
        logger.info(`Species not found in FishBase: ${genus} ${species}`);
        return null;
      }

      // Return the first match (should only be one for exact genus/species match)
      return response.data[0];
    } catch (error) {
      logger.error(`Failed to get FishBase species data for ${genus} ${species}`, error);
      return null;
    }
  }

  /**
   * Get external links and images for a species
   *
   * @param genus - Genus name
   * @param species - Species epithet
   * @returns External references and images, or null if not found
   */
  async getExternalData(genus: string, species: string): Promise<FishBaseResult | null> {
    const speciesData = await this.getSpecies(genus, species);

    if (!speciesData) {
      return null;
    }

    // Construct FishBase URL from SpecCode
    const fishbaseUrl = `https://www.fishbase.se/summary/${speciesData.SpecCode}`;

    // Collect image URLs from various fields
    const imageUrls: string[] = [];

    // Helper function to add image URLs
    const addImageUrl = (filename: string | null) => {
      if (filename) {
        // FishBase images are hosted at fishbase.se
        const imageUrl = `https://www.fishbase.se/images/species/${filename}`;
        if (!imageUrls.includes(imageUrl)) {
          imageUrls.push(imageUrl);
        }
      }
    };

    // Add images in order of preference
    addImageUrl(speciesData.PicPreferredName); // Preferred general image
    addImageUrl(speciesData.PicPreferredNameM); // Preferred male image
    addImageUrl(speciesData.PicPreferredNameF); // Preferred female image
    addImageUrl(speciesData.PicPreferredNameJ); // Preferred juvenile image
    addImageUrl(speciesData.Pic); // General image
    addImageUrl(speciesData.PictureFemale); // Female image
    addImageUrl(speciesData.LarvaPic); // Larva image
    addImageUrl(speciesData.EggPic); // Egg image

    return {
      specCode: speciesData.SpecCode,
      fishbaseUrl,
      imageUrls,
      scientificName: `${speciesData.Genus} ${speciesData.Species}`,
    };
  }

  /**
   * Test API connectivity
   *
   * @returns true if API is accessible
   */
  async testConnection(): Promise<boolean> {
    try {
      // Try a simple species query as a connectivity test
      // Using a common, well-known species
      const result = await this.getSpecies("Poecilia", "reticulata");
      return result !== null;
    } catch (error) {
      logger.error("FishBase API connection test failed", error);
      return false;
    }
  }
}

/**
 * Create a singleton FishBase client instance
 */
let clientInstance: FishBaseClient | null = null;

/**
 * Get the FishBase client instance (singleton)
 */
export function getFishBaseClient(): FishBaseClient {
  if (!clientInstance) {
    if (!config.fishbase?.enableSync) {
      throw new Error("FishBase integration is disabled in configuration");
    }
    clientInstance = new FishBaseClient();
  }
  return clientInstance;
}

/**
 * For testing: reset the singleton instance
 */
export function resetFishBaseClient(): void {
  clientInstance = null;
}
