/**
 * MCP HTTP Server with Streamable HTTP Transport
 *
 * Exposes MCP servers over HTTP using Streamable HTTP transport.
 * This allows remote access to MCP tools via HTTP endpoints.
 *
 * Only starts if mcp.enabled is true in config.
 */

import express from "express";
import type { Request, Response } from "express";
import { randomUUID } from "crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { initializeSpeciesServer } from "./species-server-core";
import { initializeMemberServer } from "./member-server-core";
import { logger } from "../utils/logger";
import config from "@/config.json";

let serverInstance: ReturnType<typeof express.application.listen> | null = null;

// Store transports by session ID for each server type
const speciesTransports: Record<string, StreamableHTTPServerTransport> = {};
const memberTransports: Record<string, StreamableHTTPServerTransport> = {};

/**
 * Create a species MCP server instance
 */
function createSpeciesServer(): Server {
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

  initializeSpeciesServer(server);
  return server;
}

/**
 * Create a member MCP server instance
 */
function createMemberServer(): Server {
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

  initializeMemberServer(server);
  return server;
}

/**
 * Create MCP handler for a specific server type
 */
function createMcpHandler(
  serverName: string,
  transports: Record<string, StreamableHTTPServerTransport>,
  createServer: () => Server
) {
  return async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    try {
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports[sessionId]) {
        // Reuse existing transport for this session
        transport = transports[sessionId];
        await transport.handleRequest(req, res, req.body);
      } else if (!sessionId && isInitializeRequest(req.body)) {
        // New initialization request - create new transport and session
        logger.info(`${serverName} MCP client initializing new session`);

        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            logger.info(`${serverName} session initialized: ${sid}`);
            transports[sid] = transport;
          },
        });

        // Set up cleanup handler
        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && transports[sid]) {
            logger.info(`${serverName} session closed: ${sid}`);
            delete transports[sid];
          }
        };

        // Connect transport to server and handle request
        const server = createServer();
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } else {
        // Invalid request
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: No valid session ID provided",
          },
          id: null,
        });
      }
    } catch (error) {
      logger.error(`Error in ${serverName} MCP endpoint:`, error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
          },
          id: null,
        });
      }
    }
  };
}

/**
 * Start the MCP HTTP server if enabled in config
 */
export async function startMcpHttpServer(): Promise<void> {
  if (!config.mcp?.enabled) {
    logger.info("MCP HTTP server disabled in config");
    return;
  }

  const mcpPort = config.mcp.port || 3001;
  const mcpHost = config.mcp.host || "127.0.0.1";

  const app = express();

  app.use(express.json());

  // Health check endpoint
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", servers: ["species", "members"] });
  });

  // Species MCP Server - POST for main communication
  const speciesHandler = createMcpHandler(
    "Species",
    speciesTransports,
    createSpeciesServer
  );
  app.post("/mcp/species", speciesHandler);
  app.get("/mcp/species", speciesHandler); // Also support GET for SSE

  // Member Management MCP Server - POST for main communication
  const memberHandler = createMcpHandler(
    "Members",
    memberTransports,
    createMemberServer
  );
  app.post("/mcp/members", memberHandler);
  app.get("/mcp/members", memberHandler); // Also support GET for SSE

  // 404 handler
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // Start server
  return new Promise<void>((resolve, reject) => {
    try {
      serverInstance = app.listen(mcpPort, mcpHost, () => {
        logger.info(`MCP HTTP server listening on ${mcpHost}:${mcpPort}`);
        logger.info(`  Species MCP: http://${mcpHost}:${mcpPort}/mcp/species`);
        logger.info(`  Members MCP: http://${mcpHost}:${mcpPort}/mcp/members`);
        resolve();
      });

      serverInstance.on("error", (error: Error) => {
        logger.error("MCP HTTP server error:", error);
        reject(error);
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error("Failed to start MCP HTTP server:", err);
      reject(err);
    }
  });
}

/**
 * Stop the MCP HTTP server
 */
export async function stopMcpHttpServer(): Promise<void> {
  // Close all active transports
  for (const sessionId in speciesTransports) {
    try {
      await speciesTransports[sessionId].close();
      delete speciesTransports[sessionId];
    } catch (error) {
      logger.error(`Error closing species transport ${sessionId}:`, error);
    }
  }

  for (const sessionId in memberTransports) {
    try {
      await memberTransports[sessionId].close();
      delete memberTransports[sessionId];
    } catch (error) {
      logger.error(`Error closing member transport ${sessionId}:`, error);
    }
  }

  // Close HTTP server
  if (serverInstance) {
    return new Promise((resolve, reject) => {
      serverInstance?.close((err) => {
        if (err) {
          logger.error("Error stopping MCP HTTP server:", err);
          reject(err);
        } else {
          logger.info("MCP HTTP server stopped");
          resolve();
        }
      });
    });
  }
}
