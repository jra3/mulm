#!/usr/bin/env node

/**
 * Backfill MCP Server (Stdio Transport)
 *
 * Provides Model Context Protocol tools for importing legacy CSV
 * submission data via stdio transport (for local CLI use).
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { initializeBackfillServer } from "./backfill-server-core";
import { logger } from "../utils/logger";

// Create MCP server
const server = new Server(
  {
    name: "backfill",
    version: "1.0.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  }
);

// Initialize server with handlers and tools
initializeBackfillServer(server);

/**
 * START SERVER
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("Backfill MCP Server running on stdio");
}

main().catch((error) => {
  logger.error("Server error:", error);
  process.exit(1);
});
