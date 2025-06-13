import * as z from "zod"

export const isLivestock = (speciesType: string) => speciesType === "Fish" || speciesType === "Invert";

export function validateFormResult<T> (
	parsed: z.SafeParseReturnType<unknown, T>,
	errors: Map<string, string>,
	onError?: () => void,
): parsed is z.SafeParseSuccess<T> {
	if (parsed.success) {
		return true;
	}
	parsed.error.issues.forEach((issue) => {
		errors.set(String(issue.path[0]), issue.message);
	});
	onError?.();
	return false;
}

export function extractValid<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  data: unknown
): Partial<z.infer<typeof schema>> {
	const result: Partial<z.infer<typeof schema>> = {};

  for (const key in schema.shape) {
		const subSchema = schema.shape[key];
    const value = data && typeof data === 'object' && key in data
      ? (data as Record<string, unknown>)[key]
      : undefined;
    const parsed = subSchema.safeParse(value);
    if (parsed.success) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      result[key] = parsed.data;
    }
	}
  return result;
}


export const multiSelect = z
  .union([z.string(), z.array(z.string())])
  .transform((val) => {
    const arr = typeof val === "string" ? [val] : val;
		return arr;
  });


// Reusable schema helpers for common patterns
export const trimmedString = (maxLength?: number, message?: string) => {
  const baseSchema = z
    .any()
    .transform((val) => val != null ? String(val).trim() : undefined)
    .transform((val) => val || undefined);

  if (maxLength) {
    return baseSchema.refine(
      (val) => val === undefined || val.length <= maxLength,
      message || `String too long (maximum ${maxLength} characters)`
    );
  }

  return baseSchema;
};

/**
 * Validates query parameters with graceful error handling and partial data recovery.
 *
 * This function solves the common problem of query parameter validation where we want to:
 * - Accept and use valid parameters even when some are invalid
 * - Provide meaningful error messages for invalid parameters
 * - Apply schema defaults for missing or invalid fields
 * - Continue processing requests with best-effort data rather than failing completely
 *
 * Instead of an all-or-nothing validation approach, this function extracts all valid
 * fields from the input, combines them with schema defaults, and returns both the
 * recovered data and any validation errors. This allows the application to provide
 * a degraded but functional experience when users provide partially invalid input.
 *
 * @param schema - Zod schema defining the expected structure and validation rules
 * @param query - Raw query parameters to validate (typically from req.query)
 * @param logContext - Optional context string for logging (e.g., "Species search API")
 *
 * @returns Object containing:
 *   - success: true if all validations passed, false if any failed
 *   - data: Validated data with schema defaults applied (always safe to use)
 *   - errors: Array of validation error messages for user feedback
 *   - isPartial: true if using fallback data due to validation errors
 *
 * @example
 * const validation = validateQueryWithFallback(
 *   speciesQuerySchema,
 *   req.query,
 *   'Species search'
 * );
 *
 * // Always safe to use validation.data, even if validation failed
 * const results = await searchSpecies(validation.data);
 *
 * // Optionally show validation warnings to user
 * if (!validation.success) {
 *   res.render('search', { results, warnings: validation.errors });
 * }
 */
export function validateQueryWithFallback<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  query: Record<string, unknown>,
  logContext?: string
): {
  success: boolean;
  data: z.infer<typeof schema>;
  errors: string[];
  isPartial: boolean;
} {
  const validation = schema.safeParse(query);

  if (validation.success) {
    return {
      success: true,
      data: validation.data,
      errors: [],
      isPartial: false
    };
  }

  if (logContext) {
    console.warn(`${logContext} validation errors:`, validation.error.issues);
  }

  const partialData = extractValid(schema, query);
  const dataWithDefaults = schema.parse({});
  const finalData = { ...dataWithDefaults, ...partialData };

  const errors = validation.error.issues.map(issue => issue.message);

  return {
    success: false,
    data: finalData,
    errors,
    isPartial: true
  };
}
