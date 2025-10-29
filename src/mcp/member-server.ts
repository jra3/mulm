#!/usr/bin/env node

/**
 * Member Management MCP Server (Stdio Transport)
 *
 * Provides Model Context Protocol tools and resources for managing
 * members via stdio transport (for local CLI use).
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { initializeMemberServer } from "./member-server-core";
import { logger } from "../utils/logger";

// Create MCP server
const server = new Server(
  {
    name: "member-management",
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
initializeMemberServer(server);

/**
 * START SERVER
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("Member Management MCP Server running on stdio");
}

main().catch((error) => {
  logger.error("Server error:", error);
  process.exit(1);
});
