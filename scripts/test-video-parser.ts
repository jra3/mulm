#!/usr/bin/env tsx

import moduleAlias from "module-alias";
import path from "path";
moduleAlias.addAlias("@", path.join(__dirname, "..", "src"));

import { parseVideoUrl } from "@/utils/videoParser";

const testUrls = [
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "https://youtu.be/dQw4w9WgXcQ",
  "https://www.youtube.com/embed/dQw4w9WgXcQ",
  "https://vimeo.com/123456789",
  "https://player.vimeo.com/video/123456789",
  "https://www.example.com/video",
  "",
];

console.log("Testing Video Parser\n");
console.log("=".repeat(80));

testUrls.forEach((url) => {
  const result = parseVideoUrl(url);
  console.log(`\nURL: ${url || "(empty)"}`);
  console.log(`  Platform: ${result.platform}`);
  console.log(`  Video ID: ${result.videoId || "null"}`);
  console.log(`  Thumbnail: ${result.thumbnailUrl || "null"}`);
  console.log(`  Embed URL: ${result.embedUrl || "null"}`);
});

console.log("\n" + "=".repeat(80));
console.log("\nAll tests completed!");
