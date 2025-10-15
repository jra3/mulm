import * as z from "zod";

export const approvalSchema = z
  .object({
    id: z
      .string()
      .max(20, "ID too long")
      .transform((val) => parseInt(val)),
    points: z
      .string()
      .max(10, "Points value too long")
      .transform((val) => parseInt(val)),
    article_points: z
      .string()
      .max(10, "Article points too long")
      .transform((val) => parseInt(val))
      .optional(),
    article_url: z.string().max(500, "URL too long").optional(),
    first_time_species: z
      .string()
      .max(10, "Value too long")
      .optional()
      .transform((val) => Boolean(val)),
    cares_species: z
      .string()
      .max(10, "Value too long")
      .optional()
      .transform((val) => Boolean(val)),
    flowered: z
      .string()
      .max(10, "Value too long")
      .optional()
      .transform((val) => Boolean(val)),
    sexual_reproduction: z
      .string()
      .max(10, "Value too long")
      .optional()
      .transform((val) => Boolean(val)),

    // NEW: group_id from species typeahead selection
    group_id: z
      .string()
      .max(20, "Group ID too long")
      .transform((val) => parseInt(val))
      .optional(),

    // DEPRECATED: Legacy manual genus/species entry (kept for backward compatibility)
    canonical_genus: z
      .string()
      .max(100, "Genus too long (max 100 characters)")
      .optional(),
    canonical_species_name: z
      .string()
      .max(100, "Species name too long (max 100 characters)")
      .optional(),
  })
  .refine(
    (data) => {
      // Either group_id OR both canonical fields must be present
      const hasGroupId = data.group_id !== undefined;
      const hasCanonicalNames =
        data.canonical_genus !== undefined &&
        data.canonical_genus.length > 0 &&
        data.canonical_species_name !== undefined &&
        data.canonical_species_name.length > 0;

      return hasGroupId || hasCanonicalNames;
    },
    {
      message: "Either species selection (group_id) or manual genus/species names are required",
      path: ["group_id"], // Show error on group_id field
    }
  );

export type ApprovalFormValues = z.infer<typeof approvalSchema>;
