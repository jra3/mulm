/**
 * Sync ALL Species - Full Database (Orchestrator)
 *
 * Master script that syncs ALL species in the database (not just those with submissions)
 * across all external data sources (Wikipedia, GBIF, FishBase).
 *
 * Designed for comprehensive coverage of the entire species catalog.
 *
 * This script:
 * - Runs Wikipedia, GBIF, and FishBase syncs in sequence
 * - Processes ALL species (2,000+ species total)
 * - Uses conservative batch sizes and delays
 * - Logs all operations with timestamps
 * - Supports resumable batching for very large datasets
 *
 * Usage:
 *   npm run script scripts/sync-all-species-full-database.ts                      # Dry-run
 *   npm run script scripts/sync-all-species-full-database.ts -- --execute         # Execute
 *   npm run script scripts/sync-all-species-full-database.ts -- --batch-size=500  # Process 500 per source
 *   npm run script scripts/sync-all-species-full-database.ts -- --species-type=Fish  # Only fish
 *
 * Recommended for initial full sync:
 *   npm run script scripts/sync-all-species-full-database.ts -- --execute --batch-size=500
 *
 *   # Then run again to get next batch:
 *   npm run script scripts/sync-all-species-full-database.ts -- --execute --batch-size=500
 *
 *   # Repeat until "Found 0 species"
 *
 * WARNING: Syncing 2,000+ species will take several hours.
 * Recommended to run in batches of 500 or use screen/tmux.
 */

import { spawn } from "child_process";
import { join } from "path";

interface SyncResult {
  source: string;
  success: boolean;
  duration: number;
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface SyncStats {
  totalSpecies: number;
  successCount: number;
  notFoundCount: number;
  errorCount: number;
  linksAdded: number;
  imagesAdded: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function parseStats(output: string): SyncStats {
  const stats: SyncStats = {
    totalSpecies: 0,
    successCount: 0,
    notFoundCount: 0,
    errorCount: 0,
    linksAdded: 0,
    imagesAdded: 0,
  };

  const totalMatch = output.match(/Total processed:\s+(\d+)/);
  if (totalMatch) stats.totalSpecies = parseInt(totalMatch[1]);

  const successMatch = output.match(/✅ Success:\s+(\d+)/);
  if (successMatch) stats.successCount = parseInt(successMatch[1]);

  const notFoundMatch = output.match(/❌ Not found:\s+(\d+)/);
  if (notFoundMatch) stats.notFoundCount = parseInt(notFoundMatch[1]);

  const errorMatch = output.match(/⚠️\s+Errors?:\s+(\d+)/);
  if (errorMatch) stats.errorCount = parseInt(errorMatch[1]);

  const linksMatch = output.match(/Total new links:\s+(\d+)/);
  if (linksMatch) stats.linksAdded = parseInt(linksMatch[1]);

  const imagesMatch = output.match(/Total new images:\s+(\d+)/);
  if (imagesMatch) stats.imagesAdded = parseInt(imagesMatch[1]);

  // Also try FishBase format
  const fbSuccessMatch = output.match(/✓ Successful:\s+(\d+)/);
  if (fbSuccessMatch) stats.successCount = parseInt(fbSuccessMatch[1]);

  const fbLinksMatch = output.match(/Links to add:\s+(\d+)/);
  if (fbLinksMatch) stats.linksAdded = parseInt(fbLinksMatch[1]);

  const fbImagesMatch = output.match(/Images to add:\s+(\d+)/);
  if (fbImagesMatch) stats.imagesAdded = parseInt(fbImagesMatch[1]);

  return stats;
}

async function runSyncScript(
  scriptPath: string,
  args: string[],
  source: string
): Promise<SyncResult> {
  const startTime = Date.now();

  return new Promise((resolve) => {
    console.log(`\n${"=".repeat(80)}`);
    console.log(`🔄 Starting ${source} sync...`);
    console.log(`   Script: ${scriptPath}`);
    console.log(`   Args: ${args.join(" ")}`);
    console.log(`   Time: ${new Date().toISOString()}`);
    console.log(`${"=".repeat(80)}\n`);

    let stdout = "";
    let stderr = "";

    const child = spawn("npm", ["run", "script", scriptPath, "--", ...args], {
      cwd: join(__dirname, ".."),
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (data) => {
      const str = data.toString();
      stdout += str;
      process.stdout.write(str);
    });

    child.stderr.on("data", (data) => {
      const str = data.toString();
      stderr += str;
      process.stderr.write(str);
    });

    child.on("close", (code) => {
      const duration = (Date.now() - startTime) / 1000;

      console.log(`\n${"=".repeat(80)}`);
      console.log(`${code === 0 ? "✅" : "❌"} ${source} sync completed`);
      console.log(`   Duration: ${duration.toFixed(1)}s (${(duration / 60).toFixed(1)} min)`);
      console.log(`   Exit code: ${code}`);
      console.log(`${"=".repeat(80)}\n`);

      resolve({
        source,
        success: code === 0,
        duration,
        stdout,
        stderr,
        exitCode: code || 0,
      });
    });

    child.on("error", (error) => {
      const duration = (Date.now() - startTime) / 1000;

      console.error(`\n❌ Error running ${source} sync:`, error);

      resolve({
        source,
        success: false,
        duration,
        stdout,
        stderr: stderr + "\n" + error.message,
        exitCode: 1,
      });
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes("--execute");
  const batchSizeArg = args.find((arg) => arg.startsWith("--batch-size="));
  const batchSize = batchSizeArg ? batchSizeArg.split("=")[1] : undefined;
  const speciesTypeArg = args.find((arg) => arg.startsWith("--species-type="));
  const speciesType = speciesTypeArg ? speciesTypeArg.split("=")[1] : undefined;
  const skipWikipedia = args.includes("--skip-wikipedia");
  const skipGbif = args.includes("--skip-gbif");
  const skipFishbase = args.includes("--skip-fishbase");

  const overallStartTime = Date.now();

  console.log("\n" + "=".repeat(80));
  console.log("🌐 Full Database External Data Sync Orchestrator");
  console.log("=".repeat(80));
  console.log(`Mode: ${execute ? "🔴 EXECUTE" : "🟡 DRY-RUN"}`);
  console.log(`Started: ${new Date().toISOString()}`);
  if (batchSize) {
    console.log(`Batch size: ${batchSize} species per source`);
  }
  if (speciesType) {
    console.log(`Species type: ${speciesType} only`);
  }
  console.log("=".repeat(80) + "\n");

  console.log("⚠️  This will sync ALL species in the database (2,000+)");
  console.log("⏱️  Expected duration: 1-3 hours for full database");
  console.log("💡 Tip: Use --batch-size=500 for resumable batches\n");

  // Build common args for all scripts
  const commonArgs: string[] = [];
  if (execute) commonArgs.push("--execute");
  if (batchSize) commonArgs.push(`--batch-size=${batchSize}`);
  if (speciesType) commonArgs.push(`--species-type=${speciesType}`);

  const results: SyncResult[] = [];

  // Run Wikipedia sync (all species types)
  if (!skipWikipedia) {
    const result = await runSyncScript(
      "scripts/sync-wikipedia-all-species.ts",
      commonArgs,
      "Wikipedia/GBIF (All Species)"
    );
    results.push(result);

    if (!skipGbif || !skipFishbase) {
      console.log("⏳ Waiting 30 seconds before next sync...\n");
      await sleep(30000);
    }
  }

  // Run GBIF sync (all species types)
  if (!skipGbif) {
    const result = await runSyncScript(
      "scripts/sync-gbif-all-species.ts",
      commonArgs,
      "GBIF (All Species)"
    );
    results.push(result);

    if (!skipFishbase) {
      console.log("⏳ Waiting 30 seconds before next sync...\n");
      await sleep(30000);
    }
  }

  // Run FishBase sync (fish only)
  if (!skipFishbase) {
    const fishArgs = [...commonArgs];
    // FishBase is fish-only, so it handles filtering internally

    const result = await runSyncScript(
      "scripts/sync-fishbase-all-species.ts",
      fishArgs,
      "FishBase (Fish Only)"
    );
    results.push(result);
  }

  // Generate final report
  const overallDuration = (Date.now() - overallStartTime) / 1000;

  console.log("\n" + "=".repeat(80));
  console.log("📊 FINAL REPORT");
  console.log("=".repeat(80));
  console.log(`Completed: ${new Date().toISOString()}`);
  console.log(`Total Duration: ${(overallDuration / 60).toFixed(1)} minutes`);
  console.log(`Mode: ${execute ? "EXECUTE" : "DRY-RUN"}`);
  console.log("");

  // Per-source results
  console.log("Per-Source Results:");
  console.log("-".repeat(80));

  let allSuccess = true;
  const totalStats: SyncStats = {
    totalSpecies: 0,
    successCount: 0,
    notFoundCount: 0,
    errorCount: 0,
    linksAdded: 0,
    imagesAdded: 0,
  };

  for (const result of results) {
    const stats = parseStats(result.stdout);
    totalStats.totalSpecies += stats.totalSpecies;
    totalStats.successCount += stats.successCount;
    totalStats.notFoundCount += stats.notFoundCount;
    totalStats.errorCount += stats.errorCount;
    totalStats.linksAdded += stats.linksAdded;
    totalStats.imagesAdded += stats.imagesAdded;

    console.log(
      `${result.success ? "✅" : "❌"} ${result.source.padEnd(30)} ` +
        `(${(result.duration / 60).toFixed(1)} min) - ` +
        `${stats.successCount} synced, ${stats.linksAdded} links, ${stats.imagesAdded} images`
    );

    if (!result.success) {
      allSuccess = false;
      if (result.stderr) {
        console.log(`   Error: ${result.stderr.split("\n")[0]}`);
      }
    }
  }

  console.log("-".repeat(80));
  console.log("");

  // Aggregate statistics
  console.log("Aggregate Statistics:");
  console.log(`  Total Species Processed: ${totalStats.totalSpecies}`);
  console.log(`  Successful Syncs: ${totalStats.successCount}`);
  console.log(`  Not Found: ${totalStats.notFoundCount}`);
  console.log(`  Errors: ${totalStats.errorCount}`);
  console.log(`  Links Added: ${totalStats.linksAdded}`);
  console.log(`  Images Added: ${totalStats.imagesAdded}`);
  console.log("");

  // Success rate
  const successRate =
    totalStats.totalSpecies > 0
      ? ((totalStats.successCount / totalStats.totalSpecies) * 100).toFixed(1)
      : "0";
  console.log(`Success Rate: ${successRate}%`);
  console.log("");

  // Final status
  if (allSuccess) {
    console.log("✅ All syncs completed successfully!");
  } else {
    console.log("⚠️  Some syncs failed - check logs above");
  }

  // Next steps
  if (batchSize && totalStats.successCount > 0) {
    console.log("");
    console.log("💡 To continue syncing the next batch:");
    console.log(
      `   npm run script scripts/sync-all-species-full-database.ts -- ${args.join(" ")}`
    );
  }

  console.log("=".repeat(80) + "\n");

  process.exit(allSuccess ? 0 : 1);
}

main().catch((error) => {
  console.error("\n❌ Fatal error in orchestrator:", error);
  process.exit(1);
});
