import * as z from "zod";

export const approvalSchema = z.object({
  id: z
    .string()
    .max(20, "ID too long")
    .transform((val) => parseInt(val)),
  points: z
    .string()
    .max(10, "Points value too long")
    .transform((val) => parseInt(val)),
  group_id: z
    .string()
    .min(1, "Species selection required")
    .max(20, "Group ID too long")
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
});

export type ApprovalFormValues = z.infer<typeof approvalSchema>;
