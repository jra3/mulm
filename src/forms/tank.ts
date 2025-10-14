import * as z from "zod";

export const tankSettingsSchema = z.object({
  preset_name: z.string().min(1, "Required").max(100, "Preset name too long (max 100 characters)"),
  tank_size: z.string().max(50, "Tank size too long (max 50 characters)").nullable().default(null),
  filter_type: z
    .string()
    .max(200, "Filter type too long (max 200 characters)")
    .nullable()
    .default(null),
  water_change_volume: z
    .string()
    .max(20, "Volume too long (max 20 characters)")
    .nullable()
    .default(null),
  water_change_frequency: z
    .string()
    .max(100, "Frequency too long (max 100 characters)")
    .nullable()
    .default(null),
  temperature: z
    .string()
    .max(20, "Temperature too long (max 20 characters)")
    .nullable()
    .default(null),
  ph: z.string().max(10, "pH too long (max 10 characters)").nullable().default(null),
  gh: z.string().max(10, "GH too long (max 10 characters)").nullable().default(null),
  specific_gravity: z
    .string()
    .max(10, "Specific gravity too long (max 10 characters)")
    .nullable()
    .default(null),
  substrate_type: z
    .string()
    .max(200, "Substrate type too long (max 200 characters)")
    .nullable()
    .default(null),
  substrate_depth: z
    .string()
    .max(50, "Substrate depth too long (max 50 characters)")
    .nullable()
    .default(null),
  substrate_color: z
    .string()
    .max(50, "Substrate color too long (max 50 characters)")
    .nullable()
    .default(null),
});
