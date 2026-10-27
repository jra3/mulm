import type { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";

/**
 * One log line per request, to find out who keeps waking the scale-to-zero
 * machine. Logs the path without its query string, which can carry reset
 * codes and OAuth state. Skips /health: Fly's checks hit it every 30s and
 * don't wake the machine. The IP comes from Fly-Client-IP: behind Fly's edge,
 * req.ip resolves to the app's own ingress address.
 */
export function formatRequestLine(fields: {
  method: string;
  path: string;
  status: number;
  ms: number;
  ip: string | undefined;
  userAgent: string | undefined;
  referer: string | undefined;
}): string {
  const { method, path, status, ms, ip, userAgent, referer } = fields;
  return [
    `HTTP ${method} ${path} ${status} ${ms}ms`,
    `ip=${ip ?? "-"}`,
    `ua=${JSON.stringify(userAgent ?? "-")}`,
    `ref=${JSON.stringify(referer ?? "-")}`,
  ].join(" ");
}

export function requestLog(req: Request, res: Response, next: NextFunction): void {
  if (req.path === "/health") return next();
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    logger.info(
      formatRequestLine({
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Math.round(Number(process.hrtime.bigint() - start) / 1e6),
        ip: req.get("fly-client-ip") ?? req.ip,
        userAgent: req.get("user-agent"),
        referer: req.get("referer"),
      })
    );
  });
  next();
}
