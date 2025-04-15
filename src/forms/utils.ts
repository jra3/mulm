import * as z from "zod"

export const isLivestock = (speciesType: string) => speciesType === "Fish" || speciesType === "Invert";

export function extractValid<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  data: unknown
): Partial<z.infer<typeof schema>> {
	const result: Partial<z.infer<typeof schema>> = {};

  for (const key in schema.shape) {
		const subSchema = schema.shape[key];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const value = (data as any)[key];
    const parsed = subSchema.safeParse(value);
    if (parsed.success) {
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
