import { Request, Response, NextFunction } from "express";
import config from "../config.json";
import { logger } from "../utils/logger";

/**
 * Origin/Referer validation — the primary CSRF backstop for issue #19.
 *
 * `SameSite=Lax` on the session cookie is the main CSRF defense, but per current
 * OWASP guidance it is only *sufficient* when the app also verifies the request
 * Origin. This middleware closes that gap: every state-changing request must
 * carry an `Origin` (or, as a fallback, `Referer`) header that resolves to a
 * same-site origin. This also neutralizes the sibling-subdomain SameSite
 * carve-out — a forged request from `evil.basny.org` carries that origin, which
 * is not allowlisted, so it is rejected.
 *
 * Safe (non-state-changing) methods are not checked. GET/HEAD/OPTIONS must
 * never mutate state (see issue #19's audit of GET routes).
 */
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Build the statically-allowlisted origins. The request's own resolved origin
 * (`${req.protocol}://${host}`) is always allowed in addition to these, which
 * is what makes same-origin POSTs work without hardcoding the deploy domain —
 * so this list is mainly for dev convenience and explicit extra origins.
 */
export function buildAllowedOrigins(): Set<string> {
  const origins = new Set<string>();
  const domain = config.server.domain;

  if (process.env.NODE_ENV === "production") {
    origins.add(`https://${domain}`);
  } else {
    // Dev/test: the app is served over plain HTTP on localhost.
    origins.add(`http://${domain}`);
    origins.add(`https://${domain}`);
    origins.add("http://localhost:4200");
    origins.add("http://127.0.0.1:4200");
  }

  // Optional comma-separated override for staging / additional deploy origins,
  // e.g. ALLOWED_ORIGINS="https://staging.bap.basny.org,https://preview.example".
  const extra = process.env.ALLOWED_ORIGINS;
  if (extra) {
    for (const entry of extra.split(",")) {
      const trimmed = entry.trim();
      if (trimmed) {
        origins.add(trimmed);
      }
    }
  }

  return origins;
}

export interface OriginValidationOptions {
  /** Override the allowlist (primarily for tests). */
  allowedOrigins?: Iterable<string>;
}

/**
 * Create an Origin/Referer validation middleware. Exported as a factory so
 * tests can inject a known allowlist; the app uses the default {@link originValidation}.
 */
export function createOriginValidation(options: OriginValidationOptions = {}) {
  const allowlist = new Set(options.allowedOrigins ?? buildAllowedOrigins());

  return function originValidation(req: Request, res: Response, next: NextFunction): void {
    if (!STATE_CHANGING_METHODS.has(req.method)) {
      next();
      return;
    }

    // The origin this request was actually sent to. With `trust proxy` set,
    // protocol/host reflect Fly's forwarded values. A forged cross-site request
    // still targets our host but carries the *attacker's* Origin, so comparing
    // against this self-origin is sound same-origin validation.
    const host = req.get("host");
    const selfOrigin = host ? `${req.protocol}://${host}` : undefined;
    const isAllowed = (origin: string): boolean =>
      allowlist.has(origin) || (selfOrigin !== undefined && origin === selfOrigin);

    const reject = (reason: string): void => {
      logger.warn("Blocked cross-origin state-changing request", {
        reason,
        method: req.method,
        path: req.path,
        origin: req.get("origin") ?? null,
        referer: req.get("referer") ?? null,
        ip: req.ip,
      });
      res.status(403).send("Forbidden: invalid request origin");
    };

    const originHeader = req.get("origin");
    if (originHeader) {
      // RFC 6454: a literal "null" Origin is an opaque/untrusted origin
      // (sandboxed iframe, data:, redirect). Never trust it for mutations.
      if (originHeader === "null") {
        reject("null origin");
        return;
      }
      if (isAllowed(originHeader)) {
        next();
        return;
      }
      reject("origin not allowlisted");
      return;
    }

    // No Origin header (some same-origin requests omit it) — fall back to Referer.
    const referer = req.get("referer");
    if (referer) {
      let refererOrigin: string;
      try {
        refererOrigin = new URL(referer).origin;
      } catch {
        reject("malformed referer");
        return;
      }
      if (isAllowed(refererOrigin)) {
        next();
        return;
      }
      reject("referer not allowlisted");
      return;
    }

    // A state-changing request with neither Origin nor Referer is rejected.
    reject("missing origin and referer");
  };
}

export const originValidation = createOriginValidation();
