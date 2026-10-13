import type { Application, Request } from "express";
import type { Env } from "./utils/environment";

// Per-app HTTP policy, not a repository/service container. Legacy handler-only
// tests that build their own Application instance retain the process environment.
const environments = new WeakMap<Application, Env>();
export function setAppEnvironment(app: Application, env: Env): void {
  environments.set(app, env);
}
export function requestEnvironment(req: Request): Env {
  return environments.get(req.app) ?? process.env;
}
