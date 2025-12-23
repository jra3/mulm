/**
 * Wikipedia/Wikidata Integration Client
 *
 * Client for integrating with Wikipedia and Wikidata to fetch:
 * - Wikipedia article URLs (multiple languages)
 * - Wikidata entity URLs
 * - Article images (prioritizing CC-licensed)
 * - Taxonomy and classification data
 *
 * Uses:
 * - Wikidata Query Service (SPARQL) for species lookup
 * - Wikipedia REST API for article data
 * - Wikimedia Commons for images
 */

import config from "@/config.json";
import { logger } from "@/utils/logger";
import {
  BaseIntegrationClient,
  type IntegrationClientConfig,
} from "./base-integration-client";

/**
 * Wikidata SPARQL query result for species
 */
export interface WikidataSpeciesResult {
  item: {
    type: string;
    value: string; // Full URL like http://www.wikidata.org/entity/Q123456
  };
  itemLabel?: {
    type: string;
    value: string;
    "xml:lang": string;
  };
  article?: {
    type: string;
    value: string; // Wikipedia article URL
  };
  image?: {
    type: string;
    value: string; // Wikimedia Commons image URL
  };
}

/**
 * Wikidata SPARQL response
 */
export interface WikidataQueryResponse {
  head: {
    vars: string[];
  };
  results: {
    bindings: WikidataSpeciesResult[];
  };
}

/**
 * Wikipedia page summary (from REST API)
 */
export interface WikipediaPageSummary {
  type: string;
  title: string;
  displaytitle: string;
  namespace: {
    id: number;
    text: string;
  };
  wikibase_item: string; // Wikidata Q-ID
  titles: {
    canonical: string;
    normalized: string;
    display: string;
  };
  pageid: number;
  thumbnail?: {
    source: string;
    width: number;
    height: number;
  };
  originalimage?: {
    source: string;
    width: number;
    height: number;
  };
  lang: string;
  dir: string;
  revision: string;
  tid: string;
  timestamp: string;
  description?: string;
  description_source?: string;
  content_urls: {
    desktop: {
      page: string;
      revisions: string;
      edit: string;
      talk: string;
    };
    mobile: {
      page: string;
      revisions: string;
      edit: string;
      talk: string;
    };
  };
  extract: string;
  extract_html: string;
}

/**
 * Result from Wikipedia/Wikidata integration
 */
export interface WikipediaResult {
  wikidataId: string; // Q-ID like "Q123456"
  wikidataUrl: string;
  wikipediaUrls: Record<string, string>; // lang code -> article URL
  imageUrls: string[];
  scientificName: string;
  commonNames?: Record<string, string>; // lang code -> common name
}

/**
 * Wikipedia/Wikidata Client
 *
 * Provides methods to query Wikidata and Wikipedia for species data
 */
export class WikipediaClient extends BaseIntegrationClient {
  protected serviceName = "Wikipedia/Wikidata";
  private wikidataUrl: string;

  constructor(clientConfig?: Partial<IntegrationClientConfig>) {
    const defaultConfig = config.wikipedia;

    if (!defaultConfig) {
      throw new Error("Wikipedia configuration not found in config.json");
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

    this.wikidataUrl = defaultConfig.wikidataUrl ?? "https://www.wikidata.org/w/api.php";
    this.logInit();
  }

  /**
   * Query Wikidata for a species by scientific name
   *
   * @param genus - Genus name
   * @param species - Species epithet
   * @returns Wikidata results or empty array if not found
   */
  async queryWikidata(genus: string, species: string): Promise<WikidataSpeciesResult[]> {
    if (!this.isEnabled()) {
      logger.warn("Wikipedia/Wikidata integration is disabled");
      return [];
    }

    const scientificName = `${genus} ${species}`;

    // SPARQL query to find species by scientific name
    const sparqlQuery = `
SELECT DISTINCT ?item ?itemLabel ?article ?image WHERE {
  # Find items with this exact taxon name
  ?item wdt:P225 "${scientificName}" .

  # Optional: Get English Wikipedia article
  OPTIONAL {
    ?article schema:about ?item ;
             schema:isPartOf <https://en.wikipedia.org/> .
  }

  # Optional: Get image
  OPTIONAL {
    ?item wdt:P18 ?image .
  }

  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 5
    `.trim();

    try {
      // Wikidata SPARQL endpoint
      const sparqlEndpoint = "https://query.wikidata.org/sparql";

      await this.enforceRateLimit();

      logger.info(`Wikidata SPARQL query for: ${scientificName}`);

      const actualUrl =
        sparqlEndpoint +
        "?" +
        new URLSearchParams({
          query: sparqlQuery,
          format: "json",
        }).toString();

      const correctResponse = await fetch(actualUrl, {
        method: "GET",
        headers: {
          Accept: "application/sparql-results+json",
          "User-Agent": "BAP-Species-Database/1.0 (mulm project)",
        },
      });

      if (!correctResponse.ok) {
        logger.warn(
          `Wikidata SPARQL query failed: ${correctResponse.status} ${correctResponse.statusText}`
        );
        return [];
      }

      const data = (await correctResponse.json()) as WikidataQueryResponse;

      if (!data.results || data.results.bindings.length === 0) {
        logger.info(`No Wikidata results found for: ${scientificName}`);
        return [];
      }

      logger.info(`Found ${data.results.bindings.length} Wikidata results for: ${scientificName}`);
      return data.results.bindings;
    } catch (error) {
      logger.error(`Failed to query Wikidata for ${scientificName}`, error);
      return [];
    }
  }

  /**
   * Get Wikipedia page summary for a given title
   *
   * @param title - Wikipedia page title
   * @param lang - Language code (default: en)
   * @returns Page summary or null if not found
   */
  async getPageSummary(title: string, lang = "en"): Promise<WikipediaPageSummary | null> {
    if (!this.isEnabled()) {
      return null;
    }

    try {
      // Wikipedia REST API endpoint for page summary
      const endpoint = `/page/summary/${encodeURIComponent(title)}`;

      // Override baseUrl for this request to use the correct language
      const originalBaseUrl = this.config.baseUrl;
      this.config.baseUrl = `https://${lang}.wikipedia.org/api/rest_v1`;

      const summary = await this.get<WikipediaPageSummary>(endpoint);

      // Restore original baseUrl
      this.config.baseUrl = originalBaseUrl;

      return summary;
    } catch (error) {
      logger.error(`Failed to get Wikipedia page summary for ${title}`, error);
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
  async getExternalData(genus: string, species: string): Promise<WikipediaResult | null> {
    const wikidataResults = await this.queryWikidata(genus, species);

    if (wikidataResults.length === 0) {
      return null;
    }

    // Use the first result (most relevant)
    const primaryResult = wikidataResults[0];

    // Extract Wikidata ID from URL
    const wikidataUrlMatch = primaryResult.item.value.match(/Q\d+$/);
    if (!wikidataUrlMatch) {
      logger.warn("Could not extract Wikidata ID from URL");
      return null;
    }

    const wikidataId = wikidataUrlMatch[0];
    const wikidataUrl = primaryResult.item.value;

    // Collect Wikipedia article URLs (try multiple languages)
    const wikipediaUrls: Record<string, string> = {};

    // If we have an English article from SPARQL, add it
    if (primaryResult.article) {
      wikipediaUrls.en = primaryResult.article.value;
    }

    // Try to get page summary for more details and images
    const scientificName = `${genus} ${species}`;
    const pageSummary = await this.getPageSummary(scientificName, "en");

    if (pageSummary && pageSummary.content_urls.desktop.page) {
      wikipediaUrls.en = pageSummary.content_urls.desktop.page;
    }

    // Collect image URLs
    const imageUrls: string[] = [];

    // Add image from SPARQL result
    if (primaryResult.image) {
      imageUrls.push(primaryResult.image.value);
    }

    // Add images from page summary
    if (pageSummary?.originalimage) {
      if (!imageUrls.includes(pageSummary.originalimage.source)) {
        imageUrls.push(pageSummary.originalimage.source);
      }
    }

    if (pageSummary?.thumbnail) {
      if (!imageUrls.includes(pageSummary.thumbnail.source)) {
        imageUrls.push(pageSummary.thumbnail.source);
      }
    }

    // Collect common names
    const commonNames: Record<string, string> = {};
    if (primaryResult.itemLabel && primaryResult.itemLabel.value !== scientificName) {
      commonNames[primaryResult.itemLabel["xml:lang"]] = primaryResult.itemLabel.value;
    }

    return {
      wikidataId,
      wikidataUrl,
      wikipediaUrls,
      imageUrls,
      scientificName,
      commonNames: Object.keys(commonNames).length > 0 ? commonNames : undefined,
    };
  }

  /**
   * Test API connectivity
   *
   * @returns true if both Wikipedia and Wikidata APIs are accessible
   */
  async testConnection(): Promise<boolean> {
    try {
      // Test Wikidata SPARQL
      const wikidataResults = await this.queryWikidata("Poecilia", "reticulata");
      if (wikidataResults.length === 0) {
        logger.warn("Wikidata test query returned no results");
        return false;
      }

      // Test Wikipedia REST API
      const pageSummary = await this.getPageSummary("Poecilia reticulata", "en");
      if (!pageSummary) {
        logger.warn("Wikipedia test query returned no results");
        return false;
      }

      logger.info("Wikipedia/Wikidata API connection test successful");
      return true;
    } catch (error) {
      logger.error("Wikipedia/Wikidata API connection test failed", error);
      return false;
    }
  }
}

/**
 * Create a singleton Wikipedia client instance
 */
let clientInstance: WikipediaClient | null = null;

/**
 * Get the Wikipedia client instance (singleton)
 */
export function getWikipediaClient(): WikipediaClient {
  if (!clientInstance) {
    if (!config.wikipedia?.enableSync) {
      throw new Error("Wikipedia integration is disabled in configuration");
    }
    clientInstance = new WikipediaClient();
  }
  return clientInstance;
}

/**
 * For testing: reset the singleton instance
 */
export function resetWikipediaClient(): void {
  clientInstance = null;
}
