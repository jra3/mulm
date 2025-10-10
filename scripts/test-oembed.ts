#!/usr/bin/env tsx

import moduleAlias from 'module-alias';
import path from 'path';
moduleAlias.addAlias('@', path.join(__dirname, '..', 'src'));

import { parseVideoUrlWithOEmbed } from '@/utils/videoParser';
import { getCacheStats, clearExpiredCache } from '@/utils/oembed';

const testUrls = [
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'https://youtu.be/jNQXAC9IVRw', // "Me at the zoo" first YouTube video
  'https://vimeo.com/148751763', // Vimeo Staff Pick
];

async function main() {
  console.log('Testing oEmbed Implementation\n');
  console.log('='.repeat(80));

  for (const url of testUrls) {
    console.log(`\nFetching: ${url}`);
    console.log('-'.repeat(80));

    try {
      const metadata = await parseVideoUrlWithOEmbed(url);

      console.log(`Platform: ${metadata.platform}`);
      console.log(`Video ID: ${metadata.videoId}`);
      console.log(`Title: ${metadata.title || '(not available)'}`);
      console.log(`Author: ${metadata.author || '(not available)'}`);
      console.log(`Thumbnail: ${metadata.thumbnailUrl}`);
      console.log(`Dimensions: ${metadata.width}x${metadata.height || '(not available)'}`);
    } catch (error) {
      console.error(`Error: ${error}`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('\nCache Statistics:');
  const stats = getCacheStats();
  console.log(`  Total entries: ${stats.size}`);
  stats.entries.forEach(entry => {
    const age = Math.round(entry.age / 1000);
    console.log(`  - ${entry.key}: ${entry.hasData ? 'HAS DATA' : 'NULL'} (${age}s old)`);
  });

  console.log('\nTest completed!');
}

main().catch(console.error);
