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
});

/**
 * Schema for collection view query parameters
 */
export const collectionViewSchema = z.object({
  includeRemoved: z
    .string()
    .optional()
    .transform((val) => val === "true" || val === "1")
    .default("false"),
});

/**
 * Schema for validating URL parameters (memberId, entryId)
 */
export const memberIdParamSchema = z.object({
  memberId: z.coerce
    .number({
      required_error: "Member ID is required",
      invalid_type_error: "Member ID must be a number",
    })
    .int()
    .positive("Member ID must be positive"),
});

export const entryIdParamSchema = z.object({
  id: z.coerce
    .number({
      required_error: "Entry ID is required",
      invalid_type_error: "Entry ID must be a number",
    })
    .int()
    .positive("Entry ID must be positive"),
});

/**
 * Schema for collection search/filter parameters
 */
export const collectionFilterSchema = z.object({
  species_type: z.enum(["Fish", "Invert", "Plant", "Coral"]).optional(),
  program_class: z.string().optional(),
  include_removed: z
    .string()
    .transform((val) => val === "true" || val === "1")
    .optional(),
  visibility: z.enum(["all", "public", "private"]).optional(),
});

/**
 * Schema for species search in collection add dialog
 */
export const speciesSearchSchema = z.object({
  q: z
    .string()
    .min(2, "Please enter at least 2 characters")
    .max(100, "Search query too long"),
  species_type: z.enum(["Fish", "Invert", "Plant", "Coral"]).optional(),
});

/**
 * Type exports for use in routes
 */
export type AddToCollectionInput = z.infer<typeof addToCollectionSchema>;
export type UpdateCollectionInput = z.infer<typeof updateCollectionSchema>;
export type CollectionFilterInput = z.infer<typeof collectionFilterSchema>;
export type SpeciesSearchInput = z.infer<typeof speciesSearchSchema>;

/**
 * Helper to format collection entry for display
 */
export function formatCollectionEntry(entry: {
  quantity: number;
  acquired_date: string;
  removed_date?: string | null;
}): string {
  const parts = [`Qty: ${entry.quantity}`];

  if (entry.acquired_date) {
    parts.push(`Acquired: ${new Date(entry.acquired_date).toLocaleDateString()}`);
  }

  if (entry.removed_date) {
    parts.push(`Removed: ${new Date(entry.removed_date).toLocaleDateString()}`);
  }

  return parts.join(" • ");
}

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

/**
 * Helper to determine collection visibility for a viewer
 */
export function getVisibilityFilter(
  memberId: number,
  viewerId: number | null
): "all" | "public" {
  return memberId === viewerId ? "all" : "public";
}