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

// Helper for consistent query validation with error handling
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
  
  // Log validation errors if context provided
  if (logContext) {
    console.warn(`${logContext} validation errors:`, validation.error.issues);
  }
  
  // Extract valid fields using existing helper
  const partialData = extractValid(schema, query);
  
  // Apply defaults from schema
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
