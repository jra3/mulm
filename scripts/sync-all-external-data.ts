/**
 * Sync All External Data Sources (Orchestrator)
 *
 * Master script that runs all external data sync operations in sequence.
 * Designed to run as a cron job during off-peak hours with conservative
 * rate limiting to be respectful to API providers.
 *
 * This script:
 * - Runs Wikipedia, GBIF, and FishBase syncs in sequence
 * - Uses conservative batch sizes and delays
 * - Logs all operations with timestamps
 * - Reports summary statistics
 * - Exits with appropriate codes for monitoring
 *
 * Usage:
 *   npm run script scripts/sync-all-external-data.ts                    # Dry-run
 *   npm run script scripts/sync-all-external-data.ts -- --execute       # Execute
 *   npm run script scripts/sync-all-external-data.ts -- --limit=20      # Test with 20 species
 *   npm run script scripts/sync-all-external-data.ts -- --skip-fishbase # Skip FishBase
 *
 * Recommended cron schedule (3 AM daily):
 *   0 3 * * * cd /opt/basny && npm run script scripts/sync-all-external-data.ts -- --execute >> /var/log/external-data-sync.log 2>&1
 */

import { spawn } from "child_process";
import { join } from "path";

interface SyncResult {
  source: string;
  success: boolean;
  duration: number; // seconds
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

/**
 * Parse sync script output to extract statistics
 */
function parseStats(output: string): SyncStats {
  const stats: SyncStats = {
    totalSpecies: 0,
    successCount: 0,
    notFoundCount: 0,
    errorCount: 0,
    linksAdded: 0,
    imagesAdded: 0,
  };

  // Extract from summary section
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

  return stats;
}

/**
 * Run a sync script as a child process
 */
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
      process.stdout.write(str); // Echo to console
    });

    child.stderr.on("data", (data) => {
      const str = data.toString();
      stderr += str;
      process.stderr.write(str); // Echo to console
    });

    child.on("close", (code) => {
      const duration = (Date.now() - startTime) / 1000;

      console.log(`\n${"=".repeat(80)}`);
      console.log(`${code === 0 ? "✅" : "❌"} ${source} sync completed`);
      console.log(`   Duration: ${duration.toFixed(1)}s`);
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
  const limitArg = args.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? limitArg.split("=")[1] : undefined;
  const skipWikipedia = args.includes("--skip-wikipedia");
  const skipGbif = args.includes("--skip-gbif");
  const skipFishbase = args.includes("--skip-fishbase");

  const overallStartTime = Date.now();

  console.log("\n" + "=".repeat(80));
  console.log("🌐 External Data Sync Orchestrator");
  console.log("=".repeat(80));
  console.log(`Mode: ${execute ? "🔴 EXECUTE" : "🟡 DRY-RUN"}`);
  console.log(`Started: ${new Date().toISOString()}`);
  if (limit) {
    console.log(`Limit: ${limit} species per source`);
  }
  console.log("=".repeat(80) + "\n");

  // Build common args for all scripts
  const commonArgs: string[] = [];
  if (execute) commonArgs.push("--execute");
  if (limit) commonArgs.push(`--limit=${limit}`);

  const results: SyncResult[] = [];

  // Run Wikipedia sync
  if (!skipWikipedia) {
    const result = await runSyncScript(
      "scripts/sync-wikipedia-external-data.ts",
      commonArgs,
      "Wikipedia/Wikidata"
    );
    results.push(result);

    // Delay between sources to be extra respectful
    if (!skipGbif || !skipFishbase) {
      console.log("⏳ Waiting 30 seconds before next sync...\n");
      await sleep(30000);
    }
  }

  // Run GBIF sync
  if (!skipGbif) {
    const result = await runSyncScript(
      "scripts/sync-gbif-external-data.ts",
      commonArgs,
      "GBIF"
    );
    results.push(result);

    // Delay before FishBase
    if (!skipFishbase) {
      console.log("⏳ Waiting 30 seconds before next sync...\n");
      await sleep(30000);
    }
  }

  // Run FishBase sync
  if (!skipFishbase) {
    const result = await runSyncScript(
      "scripts/sync-fishbase-external-data-duckdb.ts",
      commonArgs,
      "FishBase"
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
      `${result.success ? "✅" : "❌"} ${result.source.padEnd(20)} ` +
        `(${result.duration.toFixed(1)}s) - ` +
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

  console.log("=".repeat(80) + "\n");

  // Exit with appropriate code
  process.exit(allSuccess ? 0 : 1);
}

main().catch((error) => {
  console.error("\n❌ Fatal error in orchestrator:", error);
  process.exit(1);
});
