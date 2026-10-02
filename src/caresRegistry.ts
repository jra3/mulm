import type { NextFunction, Response } from "express";
import type { MulmRequest } from "./sessions";

/**
 * The CARES registry (the /cares page, registrations, seals, fry shares and
 * coverage stats) is still in development, so only admins see it. Its routes
 * and data stay in place. The CARES badge on a Species is a fact about that
 * Species, not part of the registry, and stays visible to everyone.
 */
export function canSeeCaresRegistry(viewer: MulmRequest["viewer"]): boolean {
  return Boolean(viewer?.is_admin);
}

/** Sets `showCaresRegistry` for templates. Mount after the session middleware. */
export function exposeCaresRegistry(req: MulmRequest, res: Response, next: NextFunction) {
  res.locals.showCaresRegistry = canSeeCaresRegistry(req.viewer);
  next();
}

/** Answers 404 to anyone who can't see the CARES registry, as if it weren't there. */
export function requireCaresRegistry(req: MulmRequest, res: Response, next: NextFunction) {
  if (!canSeeCaresRegistry(req.viewer)) {
    res.status(404).send("Not found");
    return;
  }
  next();
}
