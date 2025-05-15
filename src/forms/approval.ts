import * as z from "zod"

export const approvalSchema = z.object({
	id: z.string().transform(val => parseInt(val)),
	points: z.string().transform(val => parseInt(val)).optional(),
	article_points: z.string().transform(val => parseInt(val)).optional(),
	first_time_species: z.string().optional().transform(val => Boolean(val)),
	flowered: z.string().optional().transform(val => Boolean(val)),
	sexual_reproduction: z.string().optional().transform(val => Boolean(val)),

	canonical_genus: z.string(),
	canonical_species_name: z.string(),
});

export type ApprovalFormValues = z.infer<typeof approvalSchema>;
