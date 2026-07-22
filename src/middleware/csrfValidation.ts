import { Response, NextFunction } from "express";
import { MulmRequest } from "../sessions";
import { logger } from "../utils/logger";

/**
 * Synchronizer-token CSRF validation — issue #19 Phase 2 (defense-in-depth on
 * top of the Phase 1 Origin/Referer check).
 *
 * Each session has a high-entropy `csrf_token` (see migration 055). The server
 * renders it into authenticated pages as `<meta name="csrf-token">`, and
 * `/js/csrf.js` echoes it back on every state-changing request via the
 * `X-CSRF-Token` header (covering both HTMX and raw `fetch`). This middleware
 * compares the echoed token against the session's stored token.
 *
 * Scope:
 * - Only state-changing methods are checked.
 * - Only *authenticated* requests are checked — the token is issued at login,
 *   so pre-auth mutations (login/signup/password reset, passkey login) have no
 *   token yet and are already covered by Origin/Referer validation.
 * - Legacy sessions with no stored token are not blocked (the migration
 *   backfills tokens, but this guards against any gap).
 */
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function getProvidedToken(req: MulmRequest): string | undefined {
  const header = req.get("x-csrf-token");
  if (header) {
    return header;
  }
  const body = req.body as { _csrf?: unknown } | undefined;
  if (body && typeof body._csrf === "string") {
    return body._csrf;
  }
  return undefined;
}

export function csrfValidation(req: MulmRequest, res: Response, next: NextFunction): void {
  if (!STATE_CHANGING_METHODS.has(req.method)) {
    next();
    return;
  }

  // Unauthenticated requests carry no session token yet — Origin validation is
  // the control there.
  if (!req.viewer) {
    next();
    return;
  }

  const expected = req.csrfToken;
  if (!expected) {
    // Legacy/edge session without a stored token — can't validate, don't block.
    next();
    return;
  }

  const provided = getProvidedToken(req);
  if (provided && provided === expected) {
    next();
    return;
  }

  logger.warn("Blocked request failing CSRF token validation", {
    method: req.method,
    path: req.path,
    viewer: req.viewer.id,
    hasToken: Boolean(provided),
    ip: req.ip,
  });
  res.status(403).send("Forbidden: invalid or missing CSRF token");
}
