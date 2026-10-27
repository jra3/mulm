import * as z from "zod";

/**
 * Schema for adding a species to collection
 * Note: HTML forms send all data as strings, so we use coerce for numbers
 * Supports both canonical species (group_id) and free-text species (common_name + scientific_name)
 */
export const addToCollectionSchema = z.object({
  // Canonical species (from database)
  group_id: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .or(z.literal("").transform(() => undefined)),

  // Free-text species names (if not using canonical)
  common_name: z
    .string()
    .min(1, "Common name is required")
    .max(200, "Common name too long")
    .optional()
    .or(z.literal("")),

  scientific_name: z
    .string()
    .max(200, "Scientific name too long")
    .optional()
    .or(z.literal("")),

  acquired_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .refine((date) => {
      const d = new Date(date);
      const today = new Date();
      return d <= today;
    }, "Acquisition date cannot be in the future")
    .optional()
    .or(z.literal("")),

  notes: z
    .string()
    .max(500, "Notes cannot exceed 500 characters")
    .optional()
    .or(z.literal("")),

  visibility: z
    .string()
    .optional()
    .default("public")
    .transform((val) => (val === "private" ? "private" : "public")),
}).refine(
  (data) => data.group_id || data.common_name,
  {
    message: "Must provide either a species selection or a common name",
    path: ["common_name"],
  }
);

/**
 * Schema for updating a collection entry
 * Note: HTML forms send all data as strings, so we use coerce for numbers
 */
export const updateCollectionSchema = z.object({
  common_name: z
    .string()
    .min(1, "Common name is required")
    .max(200, "Common name too long")
    .optional()
    .or(z.literal("")),

  scientific_name: z
    .string()
    .max(200, "Scientific name too long")
    .optional()
    .or(z.literal("")),

  acquired_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .refine((date) => {
      const d = new Date(date);
      const today = new Date();
      return d <= today;
    }, "Acquisition date cannot be in the future")
    .optional()
    .or(z.literal("")),

  notes: z
    .string()
    .max(500, "Notes cannot exceed 500 characters")
    .optional()
    .or(z.literal("")),

  visibility: z
    .string()
    .optional()
    .default("public")
    .transform((val) => (val === "private" ? "private" : "public")),

  removed_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .nullable()
    .optional(),
}).refine(
  (data) => data.common_name || data.scientific_name,
  {
    message: "Must have at least a common name or scientific name",
    path: ["common_name"],
  }
);

/**
 * The Species to preselect in the add dialog (?species=<group_id>), from a
 * Species detail page. Absent means the generic dialog.
 */
export const addDialogQuerySchema = z.object({
  species: z.coerce.number().int().positive().optional(),
});

/**
 * Schema for validating the entry ID URL parameter
 */
export const entryIdParamSchema = z.object({
  id: z.coerce
    .number({
      error: (iss) =>
        iss.input === undefined ? "Entry ID is required" : "Entry ID must be a number",
    })
    .int()
    .positive("Entry ID must be positive"),
});

/**
 * Type exports for use in routes
 */
export type AddToCollectionInput = z.infer<typeof addToCollectionSchema>;
export type UpdateCollectionInput = z.infer<typeof updateCollectionSchema>;

/**
 * Helper to determine if user can edit a collection entry
 */
export function canEditCollection(
  entry: { member_id: number },
  viewer: { id: number; is_admin?: boolean } | null
): boolean {
  if (!viewer) return false;
  return entry.member_id === viewer.id || Boolean(viewer.is_admin);
}
