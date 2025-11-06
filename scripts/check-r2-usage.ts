#!/usr/bin/env tsx
/**
 * Check R2 storage usage and analyze image distribution
 *
 * Usage:
 *   npm run script scripts/check-r2-usage.ts
 */

import { initR2, listAllObjects, type ImageMetadata } from "../src/utils/r2-client";
import { query } from "../src/db/conn";

async function checkR2Usage() {
  console.log("=".repeat(60));
  console.log("R2 STORAGE USAGE ANALYSIS");
  console.log("=".repeat(60));

  // Initialize R2
  const r2Enabled = initR2();
  if (!r2Enabled) {
    console.error("❌ R2 is not configured. Check your config.json");
    process.exit(1);
  }

  console.log("\n📊 Fetching data from R2 and database...\n");

  try {
    // Get all R2 objects
    console.log("Listing all objects in R2...");
    const r2Objects = await listAllObjects("submissions/");

    // Calculate total size
    const totalBytes = r2Objects.reduce((sum, obj) => sum + obj.size, 0);
    const totalMB = totalBytes / (1024 * 1024);
    const totalGB = totalBytes / (1024 * 1024 * 1024);

    console.log("\n" + "=".repeat(60));
    console.log("R2 STORAGE STATISTICS");
    console.log("=".repeat(60));
    console.log(`Total objects: ${r2Objects.length.toLocaleString()}`);
    console.log(`Total size: ${totalMB.toFixed(2)} MB (${totalGB.toFixed(3)} GB)`);
    console.log(`Average file size: ${(totalBytes / r2Objects.length / 1024).toFixed(2)} KB`);

    // Analyze by variant type
    const original = r2Objects.filter(obj => obj.key.includes("-original."));
    const medium = r2Objects.filter(obj => obj.key.includes("-medium."));
    const thumb = r2Objects.filter(obj => obj.key.includes("-thumb."));

    console.log("\n" + "-".repeat(60));
    console.log("VARIANT BREAKDOWN");
    console.log("-".repeat(60));
    console.log(`Original images: ${original.length.toLocaleString()} (${(original.reduce((s, o) => s + o.size, 0) / 1024 / 1024).toFixed(2)} MB)`);
    console.log(`Medium images: ${medium.length.toLocaleString()} (${(medium.reduce((s, o) => s + o.size, 0) / 1024 / 1024).toFixed(2)} MB)`);
    console.log(`Thumbnails: ${thumb.length.toLocaleString()} (${(thumb.reduce((s, o) => s + o.size, 0) / 1024 / 1024).toFixed(2)} MB)`);

    // Get database references
    console.log("\n📂 Checking database references...");

    const submissions = await query<{ images: string | null }>(
      "SELECT images FROM submissions WHERE images IS NOT NULL"
    );

    const collections = await query<{ images: string | null }>(
      "SELECT images FROM species_collection WHERE images IS NOT NULL"
    );

    // Build referenced keys set
    const referencedKeys = new Set<string>();

    for (const row of submissions) {
      if (row.images) {
        try {
          const imageArray = JSON.parse(row.images) as ImageMetadata[];
          for (const img of imageArray) {
            referencedKeys.add(img.key);
            referencedKeys.add(img.key.replace("-original.", "-medium."));
            referencedKeys.add(img.key.replace("-original.", "-thumb."));
          }
        } catch {
          // Skip malformed JSON
        }
      }
    }

    for (const row of collections) {
      if (row.images) {
        try {
          const imageArray = JSON.parse(row.images) as ImageMetadata[];
          for (const img of imageArray) {
            referencedKeys.add(img.key);
            referencedKeys.add(img.key.replace("-original.", "-medium."));
            referencedKeys.add(img.key.replace("-original.", "-thumb."));
          }
        } catch {
          // Skip malformed JSON
        }
      }
    }

    console.log("\n" + "=".repeat(60));
    console.log("DATABASE REFERENCES");
    console.log("=".repeat(60));
    console.log(`Submissions with images: ${submissions.length}`);
    console.log(`Collection entries with images: ${collections.length}`);
    console.log(`Total referenced keys: ${referencedKeys.size.toLocaleString()}`);

    // Identify orphans
    const orphans = r2Objects.filter(obj => !referencedKeys.has(obj.key));
    const orphanBytes = orphans.reduce((sum, obj) => sum + obj.size, 0);
    const orphanMB = orphanBytes / (1024 * 1024);
    const now = Date.now(); // Declare here for use in multiple places

    console.log("\n" + "=".repeat(60));
    console.log("ORPHANED IMAGES (unreferenced in database)");
    console.log("=".repeat(60));
    console.log(`Orphaned objects: ${orphans.length.toLocaleString()}`);
    console.log(`Orphaned storage: ${orphanMB.toFixed(2)} MB`);

    if (orphans.length > 0) {
      console.log(`Percentage orphaned: ${((orphans.length / r2Objects.length) * 100).toFixed(1)}%`);

      // Analyze orphan ages
      const old = orphans.filter(obj => {
        const ageMs = now - obj.lastModified.getTime();
        const ageDays = ageMs / (1000 * 60 * 60 * 24);
        return ageDays > 7;
      });
      const recent = orphans.filter(obj => {
        const ageMs = now - obj.lastModified.getTime();
        const ageDays = ageMs / (1000 * 60 * 60 * 24);
        return ageDays <= 7;
      });

      console.log(`\nOrphans >7 days old: ${old.length} (eligible for cleanup)`);
      console.log(`Orphans <=7 days old: ${recent.length} (protected by safety threshold)`);

      const reclaimableMB = old.reduce((sum, obj) => sum + obj.size, 0) / (1024 * 1024);
      console.log(`Reclaimable storage: ${reclaimableMB.toFixed(2)} MB`);

      // Show sample orphans
      if (old.length > 0) {
        console.log(`\nSample orphaned images (old):`);
        old.slice(0, 5).forEach(obj => {
          const ageDays = (now - obj.lastModified.getTime()) / (1000 * 60 * 60 * 24);
          console.log(`  - ${obj.key}`);
          console.log(`    Age: ${ageDays.toFixed(1)} days, Size: ${(obj.size / 1024).toFixed(2)} KB`);
        });
        if (old.length > 5) {
          console.log(`  ... and ${old.length - 5} more`);
        }
      }
    } else {
      console.log("✅ No orphaned images found!");
    }

    console.log("\n" + "=".repeat(60));
    console.log("SUMMARY");
    console.log("=".repeat(60));
    console.log(`Total storage: ${totalMB.toFixed(2)} MB`);
    console.log(`Active images: ${referencedKeys.size.toLocaleString()} keys`);
    console.log(`Orphaned images: ${orphans.length.toLocaleString()} keys (${orphanMB.toFixed(2)} MB)`);

    if (orphans.length > 0) {
      const oldOrphans = orphans.filter(obj => {
        const ageDays = (now - obj.lastModified.getTime()) / (1000 * 60 * 60 * 24);
        return ageDays > 7;
      });
      console.log(`Cleanup recommendation: Run daily cleanup to reclaim ${(oldOrphans.reduce((s, o) => s + o.size, 0) / 1024 / 1024).toFixed(2)} MB`);
    }

    console.log("=".repeat(60));

  } catch (error) {
    console.error("\n❌ Error during R2 usage analysis:", error);
    process.exit(1);
  }
}

checkR2Usage().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
