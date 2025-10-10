/**
 * Video URL Parser
 *
 * Extracts platform, video ID, and thumbnail URL from video sharing links.
 * Supports YouTube and Vimeo.
 */

export interface VideoMetadata {
  platform: 'youtube' | 'vimeo' | 'unknown';
  videoId: string | null;
  thumbnailUrl: string | null;
  embedUrl: string | null;
  originalUrl: string;
}

/**
 * Parse a video URL and extract metadata
 */
export function parseVideoUrl(url: string): VideoMetadata {
  if (!url || typeof url !== 'string') {
    return {
      platform: 'unknown',
      videoId: null,
      thumbnailUrl: null,
      embedUrl: null,
      originalUrl: url,
    };
  }

  const trimmed = url.trim();

  // Try YouTube first
  const youtubeMetadata = parseYouTubeUrl(trimmed);
  if (youtubeMetadata.videoId) {
    return youtubeMetadata;
  }

  // Try Vimeo
  const vimeoMetadata = parseVimeoUrl(trimmed);
  if (vimeoMetadata.videoId) {
    return vimeoMetadata;
  }

  // Unknown platform
  return {
    platform: 'unknown',
    videoId: null,
    thumbnailUrl: null,
    embedUrl: null,
    originalUrl: trimmed,
  };
}

/**
 * Parse YouTube URLs
 * Supports:
 * - https://www.youtube.com/watch?v=VIDEO_ID
 * - https://youtu.be/VIDEO_ID
 * - https://www.youtube.com/embed/VIDEO_ID
 */
function parseYouTubeUrl(url: string): VideoMetadata {
  const patterns = [
    // Standard watch URL
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    // Short URL
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    // Embed URL
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      const videoId = match[1];
      return {
        platform: 'youtube',
        videoId,
        // Use mqdefault for medium quality thumbnail (320x180)
        thumbnailUrl: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
        embedUrl: `https://www.youtube.com/embed/${videoId}`,
        originalUrl: url,
      };
    }
  }

  return {
    platform: 'unknown',
    videoId: null,
    thumbnailUrl: null,
    embedUrl: null,
    originalUrl: url,
  };
}

/**
 * Parse Vimeo URLs
 * Supports:
 * - https://vimeo.com/VIDEO_ID
 * - https://player.vimeo.com/video/VIDEO_ID
 */
function parseVimeoUrl(url: string): VideoMetadata {
  const patterns = [
    // Standard URL
    /(?:vimeo\.com\/)([0-9]+)/,
    // Player URL
    /(?:player\.vimeo\.com\/video\/)([0-9]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      const videoId = match[1];
      return {
        platform: 'vimeo',
        videoId,
        // Vimeo thumbnails require API call, so we'll use a placeholder approach
        // In production, you'd fetch from: https://vimeo.com/api/v2/video/{videoId}.json
        // For now, just use the video page as the thumbnail will be fetched client-side
        thumbnailUrl: `https://vumbnail.com/${videoId}.jpg`,
        embedUrl: `https://player.vimeo.com/video/${videoId}`,
        originalUrl: url,
      };
    }
  }

  return {
    platform: 'unknown',
    videoId: null,
    thumbnailUrl: null,
    embedUrl: null,
    originalUrl: url,
  };
}

/**
 * Validate if a string looks like a video URL
 */
export function isValidVideoUrl(url: string): boolean {
  if (!url || typeof url !== 'string') {
    return false;
  }

  const metadata = parseVideoUrl(url);
  return metadata.platform !== 'unknown' && metadata.videoId !== null;
}
