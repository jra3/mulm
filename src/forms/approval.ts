import * as z from "zod"

export const approvalSchema = z.object({
	reject: z.string().optional(),
	delete: z.string().optional(),
	id: z.string().transform(val => parseInt(val)),
	points: z.string().transform(val => parseInt(val)).optional(),
});
