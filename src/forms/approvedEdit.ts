import { z } from "zod";
import { formBoolean } from "./formBoolean";
import { multiSelect } from "./utils";

/**
 * Validation schema for editing approved submissions
 * Allows admins to correct errors in already-approved submissions
 */
export const approvedEditSchema = z.object({
  // Species & Points
  group_id: z.coerce.number().int().positive().optional(),
  points: z.coerce.number().int().min(0).max(100).optional(),
  article_points: z.coerce.number().int().min(0).max(50).optional(),
  first_time_species: formBoolean(),
  cares_species: formBoolean(),
  flowered: formBoolean(),
  sexual_reproduction: formBoolean(),

  // Dates & Details
  reproduction_date: z.string().optional(),
  count: z.string().optional(),

  // Arrays (multi-select fields)
  foods: multiSelect.optional(),
  spawn_locations: multiSelect.optional(),
  supplement_type: z.string().optional(), // TODO: Convert to multiSelect
  supplement_regimen: z.string().optional(), // Text field, not multi-select

  // Tank parameters
  tank_size: z.string().optional(),
  filter_type: z.string().optional(),
  water_change_volume: z.string().optional(),
  water_change_frequency: z.string().optional(),
  temperature: z.string().optional(),
  ph: z.string().optional(),
  gh: z.string().optional(),
  specific_gravity: z.string().optional(),
  substrate_type: z.string().optional(),
  substrate_depth: z.string().optional(),
  substrate_color: z.string().optional(),
  light_type: z.string().optional(),
  light_strength: z.string().optional(),
  light_hours: z.string().optional(),
  co2: z.string().optional(),
  co2_description: z.string().optional(),
  propagation_method: z.string().optional(),

  // Media
  video_url: z.string().url().optional().or(z.literal("")),

  // Required reason (not stored in submissions table, goes to audit log)
  reason: z.string().min(3, "Please provide a reason (at least 3 characters)").max(2000),
});

export type ApprovedEditFormValues = z.infer<typeof approvedEditSchema>;
