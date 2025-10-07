/**
 * Password complexity validation with configurable levels
 *
 * Level 1: Length only (NIST recommended) - Good user experience
 * Level 2: Length + basic complexity - Balanced
 * Level 3: Length + full complexity - Maximum security
 */

export type PasswordComplexityLevel = 1 | 2 | 3;

// Configure which level to use (can be moved to config.json later)
export const PASSWORD_COMPLEXITY_LEVEL: PasswordComplexityLevel = 1;

const MIN_LENGTH = 12;

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate password based on configured complexity level
 */
export function validatePasswordComplexity(password: string): PasswordValidationResult {
  const errors: string[] = [];

  // Level 1: Length requirement (applies to all levels)
  if (password.length < MIN_LENGTH) {
    errors.push(`Password must be at least ${MIN_LENGTH} characters`);
  }

  if (PASSWORD_COMPLEXITY_LEVEL >= 2) {
    // Level 2: Basic complexity requirements
    if (!/[a-z]/.test(password)) {
      errors.push("Password must contain at least one lowercase letter");
    }
    if (!/[A-Z]/.test(password)) {
      errors.push("Password must contain at least one uppercase letter");
    }
    if (!/[0-9]/.test(password)) {
      errors.push("Password must contain at least one number");
    }
  }

  if (PASSWORD_COMPLEXITY_LEVEL >= 3) {
    // Level 3: Special character requirement
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
      errors.push("Password must contain at least one special character");
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Get password requirements message based on complexity level
 * Used for displaying hints to users
 */
export function getPasswordRequirementsMessage(): string {
  let message = `Must be at least ${MIN_LENGTH} characters`;

  if (PASSWORD_COMPLEXITY_LEVEL >= 2) {
    message += " and contain uppercase, lowercase, and numbers";
  }

  if (PASSWORD_COMPLEXITY_LEVEL >= 3) {
    message += ", and a special character";
  }

  return message;
}

/**
 * Get detailed password requirements for UI
 */
export function getPasswordRequirements(): Array<{ requirement: string; met?: boolean }> {
  const requirements = [
    { requirement: `At least ${MIN_LENGTH} characters` }
  ];

  if (PASSWORD_COMPLEXITY_LEVEL >= 2) {
    requirements.push(
      { requirement: 'One lowercase letter (a-z)' },
      { requirement: 'One uppercase letter (A-Z)' },
      { requirement: 'One number (0-9)' }
    );
  }

  if (PASSWORD_COMPLEXITY_LEVEL >= 3) {
    requirements.push(
      { requirement: 'One special character (!@#$...)' }
    );
  }

  return requirements;
}
