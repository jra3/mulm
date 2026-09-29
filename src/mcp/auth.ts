/**
 * Bearer-token auth for the MCP HTTP server.
 *
 * The MCP tools can delete members and grant admin, so any bind address
 * reachable from outside the machine must carry a token. Loopback stays
 * token-optional for local dev.
 */

import { createHash, timingSafeEqual } from "crypto";
import type { RequestHandler } from "express";

const MIN_TOKEN_LENGTH = 16;

export function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "::1" || /^127\.\d+\.\d+\.\d+$/.test(host);
}

/**
 * The token the server should enforce, or undefined for none.
 * Throws when the bind address is reachable and no usable token is set.
 */
export function resolveMcpToken(host: string, token: string | undefined): string | undefined {
  if (!token) {
    if (isLoopbackHost(host)) return undefined;
    throw new Error(
      `MCP HTTP server bound to ${host} requires mcp.token in config; refusing to start without auth`
    );
  }
  if (token.length < MIN_TOKEN_LENGTH) {
    throw new Error(`mcp.token must be at least ${MIN_TOKEN_LENGTH} characters`);
  }
  return token;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function createMcpAuth(token: string | undefined): RequestHandler {
  if (!token) return (_req, _res, next) => next();

  const expected = digest(token);
  return (req, res, next) => {
    const header = req.headers.authorization ?? "";
    const match = /^Bearer (.+)$/.exec(header);
    if (match && timingSafeEqual(digest(match[1]), expected)) {
      next();
      return;
    }
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized" },
      id: null,
    });
  };
}
