import { Response } from "express";
import {
  AuthorizationError,
  isLifecycleError,
  StateError,
  ValidationError,
} from "@/lifecycle";
import { logger } from "@/utils/logger";

/**
 * Turn a lifecycle refusal into a response, in one place.
 *
 * The three-way taxonomy maps onto HTTP directly: the wrong person is a 403,
 * the wrong moment or a thing that is not there is a 400. This replaces the
 * `instanceof` chain that appeared four times across two route files, each
 * spelling the mapping slightly differently.
 *
 * Returns whether it handled the error; anything else is a bug and belongs in
 * the caller's 500 path.
 */
export function sendLifecycleError(res: Response, err: unknown, context: object = {}): boolean {
  if (!isLifecycleError(err)) {
    return false;
  }

  logger.warn(`Lifecycle refusal: ${err.message}`, {
    ...context,
    errorType: err.name,
    errorCode: err.code,
    errorContext: err.context,
  });

  if (err instanceof AuthorizationError) {
    res.status(403).send(err.message);
    return true;
  }

  if (err instanceof StateError || err instanceof ValidationError) {
    res.status(400).send(err.message);
    return true;
  }

  res.status(400).send(err.message);
  return true;
}
