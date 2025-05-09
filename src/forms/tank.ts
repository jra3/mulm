import * as z from "zod";

export const tankSettingsSchema = z.object({
	tank_size: z.string().nullable().default(null),
	filter_type: z.string().nullable().default(null),
	water_change_volume: z.string().nullable().default(null),
	water_change_frequency: z.string().nullable().default(null),
	temperature: z.string().nullable().default(null),
	ph: z.string().nullable().default(null),
	gh: z.string().nullable().default(null),
	specific_gravity: z.string().nullable().default(null),
	substrate_type: z.string().nullable().default(null),
	substrate_depth: z.string().nullable().default(null),
	substrate_color: z.string().nullable().default(null),
});
