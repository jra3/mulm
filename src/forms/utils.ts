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
