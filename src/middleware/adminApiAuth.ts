import { Request, Response, NextFunction } from "express";
import { verifyAdminToken, type AdminApiActor } from "../db/adminTokens";
import { logger } from "../utils/logger";

/**
 * A request on /api/admin. `adminApi` is the admin the bearer token acts as;
 * endpoints stamp audit and admin notes with `adminApi.member.id`. It is a
 * field of its own, not `viewer`, because this API never has a session.
 */
export type AdminApiRequest = Request & { adminApi?: AdminApiActor };

/** The authenticated admin, for handlers mounted behind {@link adminApiAuth}. */
export function adminApiActor(req: AdminApiRequest): AdminApiActor {
  if (!req.adminApi) throw new Error("adminApiAuth must run before this handler");
  return req.adminApi;
}

export function sendApiError(res: Response, status: number, error: string, message: string) {
  res.status(status).json({ error, message });
}

const BEARER = /^Bearer ([^\s]+)$/;

/**
 * Bearer-token authentication for /api/admin (#595). The only credential is
 * `Authorization: Bearer <admin API token>`; the session cookie is never read,
 * which is why the API sits outside the Origin and CSRF checks. The token's
 * member must still be an admin on every request.
 */
export async function adminApiAuth(
  req: AdminApiRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const match = BEARER.exec(req.get("authorization") ?? "");
  if (!match) {
    res.set("WWW-Authenticate", 'Bearer realm="admin-api"');
    sendApiError(res, 401, "unauthorized", "Send an admin API token as Authorization: Bearer");
    return;
  }

  const result = await verifyAdminToken(match[1]);
  if (!result.ok) {
    if (result.reason === "not_admin") {
      logger.warn("Admin API token used by a member who is no longer an admin", {
        ip: req.ip,
        path: req.path,
      });
      sendApiError(res, 403, "forbidden", "This token's member is no longer an admin");
      return;
    }
    logger.warn("Admin API request with an invalid token", { ip: req.ip, path: req.path });
    res.set("WWW-Authenticate", 'Bearer realm="admin-api", error="invalid_token"');
    sendApiError(res, 401, "unauthorized", "Invalid, expired or revoked admin API token");
    return;
  }

  req.adminApi = result.actor;
  next();
}
