import { z } from "zod";
import { multiSelect } from "./utils";

/**
 * The Edit Approved Submission dialog's form (#529): the member's own details
 * on an Approved Submission, and a reason. No Species and no points fields:
 * those are corrected on the correction form (`correctPointsSchema`), with
 * the consequences a correction carries. An unknown field, a `points` or a
 * `group_id` among them, is stripped here and refused again by the
 * transition, so a stale tab cannot smuggle a points change past the dialog.
 *
 * Every detail is optional: the dialog posts the fields its tabs show, which
 * depend on the Species type, and the transition diffs them against the row.
 */
export const editApprovedDetailsForm = z.object({
  // Dates & Details
  reproduction_date: z.string().optional(),
  count: z.string().optional(),
  foods: multiSelect.optional(),
  spawn_locations: multiSelect.optional(),
  propagation_method: z.string().optional(),

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

  // Supplements (Plant and Coral, #158): the Member form's paired inputs,
  // validated as it validates them. Removing every row from an HTML form
  // posts nothing at all, which looks the same as a dialog that never showed
  // the section, so the section also posts `supplements_present=1`: with it,
  // the posted rows (none included) replace the stored ones; without it, the
  // rows are left alone, so a Fish dialog or a stale tab cannot erase them.
  supplements_present: z.literal("1").optional(),
  supplement_type: multiSelect.optional(),
  supplement_regimen: multiSelect.optional(),

  // Media
  video_url: z.string().url().optional().or(z.literal("")),
  article_link: z.string().url().optional().or(z.literal("")),

  // Notes
  notes: z.string().max(2000).optional().or(z.literal("")),

  // Why: goes on the changelog, not the row
  reason: z
    .string({ error: "Say why the details are being changed" })
    .trim()
    .min(3, "Say why the details are being changed (at least 3 characters)")
    .max(2000),
});

export type EditApprovedDetailsFormValues = z.infer<typeof editApprovedDetailsForm>;
