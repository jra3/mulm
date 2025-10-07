import * as z from "zod"

export const approvalSchema = z.object({
  id: z.string().max(20, "ID too long").transform(val => parseInt(val)),
  points: z.string().max(10, "Points value too long").transform(val => parseInt(val)),
  article_points: z.string().max(10, "Article points too long").transform(val => parseInt(val)).optional(),
  first_time_species: z.string().max(10, "Value too long").optional().transform(val => Boolean(val)),
  flowered: z.string().max(10, "Value too long").optional().transform(val => Boolean(val)),
  sexual_reproduction: z.string().max(10, "Value too long").optional().transform(val => Boolean(val)),

  canonical_genus: z.string().min(1, "Required").max(100, "Genus too long (max 100 characters)"),
  canonical_species_name: z.string().min(1, "Required").max(100, "Species name too long (max 100 characters)"),
});

export type ApprovalFormValues = z.infer<typeof approvalSchema>;
