import * as z from "zod"

export const memberSchema = z.object({
	display_name: z.string().nonempty({ message: "Required" }),
	contact_email: z.string().email("Valid address required"),
	is_admin: z.string().optional(),
	fish_level: z.string().optional(),
	plant_level: z.string().optional(),
	coral_level: z.string().optional(),
});
