/**
 * Custom error classes for the witness system
 * Provides structured error handling with error codes and context
 */

/**
 * Base error class for all witness-related errors
 * Includes error code and structured context for debugging
 */
export class WitnessError extends Error {
  public readonly code: string;
  public readonly context: Record<string, unknown>;

  constructor(message: string, code: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = "WitnessError";
    this.code = code;
    this.context = context;

    // Maintains proper stack trace for where error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Thrown when input validation fails (invalid IDs, missing data, etc.)
 */
export class ValidationError extends WitnessError {
  constructor(message: string, field: string, value: unknown) {
    super(message, "VALIDATION_ERROR", { field, value });
    this.name = "ValidationError";
  }
}

/**
 * Thrown when user lacks permission to perform an action
 */
export class AuthorizationError extends WitnessError {
  constructor(message: string, userId: number, action: string) {
    super(message, "AUTHORIZATION_ERROR", { userId, action });
    this.name = "AuthorizationError";
  }
}

/**
 * Thrown when an operation is attempted on an entity in the wrong state
 */
export class StateError extends WitnessError {
  constructor(message: string, expectedState: string, actualState: string) {
    super(message, "STATE_ERROR", { expectedState, actualState });
    this.name = "StateError";
  }
}
