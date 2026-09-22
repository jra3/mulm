import * as z from "zod";
import { refineProgramBonuses } from "@/points";

const approvalFields = z.object({
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
});

/**
 * The approval form for a submission in `program`: the same fields whatever the
 * program, plus the per-program bonus rule from src/points.ts. There is no
 * program-less export, because a schema that does not know the program cannot
 * tell a bonus that applies from one that does not.
 */
export function approvalSchema(program: string) {
  return approvalFields.superRefine(refineProgramBonuses(program));
}

export type ApprovalFormValues = z.infer<ReturnType<typeof approvalSchema>>;
