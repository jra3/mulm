/**
 * The admin API (#595), mounted at /api/admin ahead of the cookie, session,
 * Origin and CSRF middleware in app.ts: it authenticates by bearer token alone.
 * Every response, errors included, is JSON. See docs/ADMIN_API.md.
 */
import express, { type NextFunction, type Response } from "express";
import { adminApiRateLimiter } from "../../middleware/rateLimiter";
import {
  adminApiActor,
  adminApiAuth,
  sendApiError,
  type AdminApiRequest,
} from "../../middleware/adminApiAuth";
import { logger } from "../../utils/logger";
import membersRouter from "./admin/members";
import speciesRouter from "./admin/species";
import submissionsRouter from "./admin/submissions";

const router = express.Router();

router.use(adminApiRateLimiter);
router.use(adminApiAuth);
router.use(express.json({ limit: "1mb" }));

router.get("/whoami", (req: AdminApiRequest, res) => {
  const { member, token } = adminApiActor(req);
  res.json({
    member: { id: member.id, display_name: member.display_name },
    token: {
      id: token.id,
      name: token.name,
      created_at: token.created_at,
      expires_at: token.expires_at,
    },
  });
});

router.use("/members", membersRouter);
router.use("/species", speciesRouter);
router.use("/submissions", submissionsRouter);

router.use((req, res) => {
  sendApiError(res, 404, "not_found", `No admin API endpoint ${req.method} ${req.path}`);
});

/** Error handler for the admin API: malformed JSON is a 400, anything else a 500. */
function adminApiErrorHandler(
  err: unknown,
  req: AdminApiRequest,
  res: Response,
  next: NextFunction
): void {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err instanceof SyntaxError && "body" in err) {
    sendApiError(res, 400, "bad_request", "Request body is not valid JSON");
    return;
  }
  const status =
    typeof err === "object" && err !== null && "status" in err && typeof err.status === "number"
      ? err.status
      : 500;
  if (status >= 400 && status < 500) {
    sendApiError(res, status, "bad_request", err instanceof Error ? err.message : "Bad request");
    return;
  }
  logger.error(`Admin API error on ${req.method} ${req.path}`, err);
  sendApiError(res, 500, "internal_error", "Internal server error");
}

router.use(adminApiErrorHandler);

export default router;
