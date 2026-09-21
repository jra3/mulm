import { Response } from "express";
import { AuthorizationError, isLifecycleError, type Caller } from "@/lifecycle";
import type { MulmRequest } from "@/sessions";
import { logger } from "@/utils/logger";

/**
 * The viewer, as the lifecycle module wants them.
 *
 * A committee member is a member holding `is_admin`; which hat they are
 * actually wearing for a given Submission is the module's to decide, not the
 * route's.
 */
export function callerFor(viewer: NonNullable<MulmRequest["viewer"]>): Caller {
  return { id: viewer.id, isAdmin: Boolean(viewer.is_admin) };
}

/**
 * Run a transition, answering the caller if it refuses.
 *
 * Every route does the same thing with a refusal - say so and stop - so the
 * try/catch lives here once rather than at each of a dozen call sites.
 * `ran: false` means the caller has already been answered.
 */
export type Attempt<T> = { ran: true; value: T } | { ran: false };

export async function attempt<T>(
  res: Response,
  context: object,
  move: () => Promise<T>
): Promise<Attempt<T>> {
  try {
    return { ran: true, value: await move() };
  } catch (err) {
    if (sendLifecycleError(res, err, context)) {
      return { ran: false };
    }
    throw err;
  }
}

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

  // The wrong person is a 403; the wrong moment, or a thing that is not there,
  // is a 400.
  res.status(err instanceof AuthorizationError ? 403 : 400).send(err.message);
  return true;
}
