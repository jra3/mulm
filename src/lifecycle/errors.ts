/**
 * The lifecycle's error taxonomy.
 *
 * Three kinds, so a refusal can say whether the caller was the wrong person or
 * it was the wrong moment:
 *
 *   ValidationError    - the request did not name a thing that exists
 *   AuthorizationError - the wrong person
 *   StateError         - the wrong moment
 *   UnboundError       - a move that needs a Species, on a Submission bound to none
 *   MismatchError      - the Submission's Species type or Program class disagrees
 *                        with its bound Species
 *
 * Every transition throws one of these and nothing else, so a route matches on
 * the class rather than on a message string.
 */

/** Base class: carries a machine-readable code and structured context. */
export class LifecycleError extends Error {
  public readonly code: string;
  public readonly context: Record<string, unknown>;

  constructor(message: string, code: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = "LifecycleError";
    this.code = code;
    this.context = context;

    // Maintains proper stack trace for where error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/** Thrown when input validation fails (invalid IDs, missing data, etc.) */
export class ValidationError extends LifecycleError {
  constructor(message: string, field: string, value: unknown) {
    super(message, "VALIDATION_ERROR", { field, value });
    this.name = "ValidationError";
  }
}

/** Thrown when the actor is not allowed to perform this move. */
export class AuthorizationError extends LifecycleError {
  constructor(message: string, userId: number, action: string) {
    super(message, "AUTHORIZATION_ERROR", { userId, action });
    this.name = "AuthorizationError";
  }
}

/** Thrown when the move is not legal from the submission's current state. */
export class StateError extends LifecycleError {
  constructor(message: string, expectedState: string, actualState: string) {
    super(message, "STATE_ERROR", { expectedState, actualState });
    this.name = "StateError";
  }
}

/**
 * Thrown when a move needs the Submission bound to a Species and it is bound
 * to none: the Witness is refused until the committee picks the Species, so
 * nothing enters the waiting period without one.
 */
export class UnboundError extends LifecycleError {
  constructor(message: string, action: string) {
    super(message, "UNBOUND", { action });
    this.name = "UnboundError";
  }
}

/**
 * Thrown when a move needs the Submission's Species type and Program class to
 * agree with its bound Species', and they do not: a Corydoras cannot be
 * witnessed as a Cichlid. The witness adopts the Species' values, rebinds, or
 * requests changes.
 */
export class MismatchError extends LifecycleError {
  constructor(message: string, action: string) {
    super(message, "MISMATCH", { action });
    this.name = "MismatchError";
  }
}

/** True for any error this module raises deliberately, as opposed to a bug. */
export function isLifecycleError(err: unknown): err is LifecycleError {
  return err instanceof LifecycleError;
}
