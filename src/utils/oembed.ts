/**
 * oEmbed API Client
 *
 * Fetches rich video metadata from oEmbed endpoints for YouTube and Vimeo.
 * Includes in-memory caching to avoid repeated API calls.
 */

import { logger } from './logger';

export interface OEmbedData {
  type: 'video' | 'photo' | 'link' | 'rich';
  version: string;
  title?: string;
  author_name?: string;
  author_url?: string;
  provider_name?: string;
  provider_url?: string;
  thumbnail_url?: string;
  thumbnail_width?: number;
  thumbnail_height?: number;
  html?: string;
  width?: number;
  height?: number;
}

interface CacheEntry {
  data: OEmbedData | null;
  timestamp: number;
}

// In-memory cache with 1 hour TTL
const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour in milliseconds

/**
 * Get oEmbed endpoint URL for a video platform
 */
function getOEmbedEndpoint(platform: 'youtube' | 'vimeo', videoUrl: string): string | null {
  switch (platform) {
    case 'youtube':
      return `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`;
    case 'vimeo':
      return `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(videoUrl)}`;
    default:
      return null;
  }
}

/**
 * Fetch oEmbed data from a video URL
 */
export async function fetchOEmbed(
  platform: 'youtube' | 'vimeo',
  videoUrl: string
): Promise<OEmbedData | null> {
  const cacheKey = `${platform}:${videoUrl}`;

  // Check cache first
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    logger.info(`oEmbed cache hit for ${platform}: ${videoUrl}`);
    return cached.data;
  }

  const endpoint = getOEmbedEndpoint(platform, videoUrl);
  if (!endpoint) {
    logger.warn(`No oEmbed endpoint for platform: ${platform}`);
    return null;
  }

  try {
    logger.info(`Fetching oEmbed data from ${platform} for: ${videoUrl}`);
    const response = await fetch(endpoint, {
      headers: {
        'User-Agent': 'Mulm-BAP/1.0',
      },
    });

    if (!response.ok) {
      logger.warn(`oEmbed fetch failed: ${response.status} ${response.statusText}`);
      cache.set(cacheKey, { data: null, timestamp: Date.now() });
      return null;
    }

    const data = (await response.json()) as OEmbedData;

    // Validate required fields
    if (!data.type || !data.version) {
      logger.warn('Invalid oEmbed response: missing required fields');
      cache.set(cacheKey, { data: null, timestamp: Date.now() });
      return null;
    }

    // Cache the result
    cache.set(cacheKey, { data, timestamp: Date.now() });
    logger.info(`oEmbed data cached for ${platform}: ${data.title || 'untitled'}`);

    return data;
  } catch (error) {
    logger.error(`Error fetching oEmbed data from ${platform}:`, error);
    cache.set(cacheKey, { data: null, timestamp: Date.now() });
    return null;
  }
}

/**
 * Clear expired cache entries
 */
export function clearExpiredCache(): number {
  const now = Date.now();
  let cleared = 0;

  for (const [key, entry] of cache.entries()) {
    if (now - entry.timestamp > CACHE_TTL) {
      cache.delete(key);
      cleared++;
    }
  }

  if (cleared > 0) {
    logger.info(`Cleared ${cleared} expired oEmbed cache entries`);
  }

  return cleared;
}

/**
 * Get cache statistics
 */
export function getCacheStats() {
  return {
    size: cache.size,
    entries: Array.from(cache.entries()).map(([key, entry]) => ({
      key,
      hasData: entry.data !== null,
      age: Date.now() - entry.timestamp,
    })),
  };
}

// Periodically clear expired cache entries (every 15 minutes)
setInterval(clearExpiredCache, 15 * 60 * 1000);
