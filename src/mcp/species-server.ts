#!/usr/bin/env node

/**
 * Species Database MCP Server (Stdio Transport)
 *
 * Provides Model Context Protocol tools and resources for managing
 * the species database via stdio transport (for local CLI use).
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { initializeSpeciesServer } from "./species-server-core";
import { logger } from "../utils/logger";

// Create MCP server
const server = new Server(
  {
    name: "species-database",
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
initializeSpeciesServer(server);

/**
 * START SERVER
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("Species Database MCP Server running on stdio");
}

main().catch((error) => {
  logger.error("Server error:", error);
  process.exit(1);
});
