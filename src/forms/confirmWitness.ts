import { z } from "zod";

/** A ticked checkbox posts "on"; an unticked one posts nothing. */
const checkbox = z
  .literal("on", { error: "Unexpected value for a Name to add" })
  .optional()
  .transform((val) => val === "on");

/**
 * The witness panel's confirm form: which of the Submission's spellings the
 * witness adds to the bound Species as Names.
 */
export const confirmWitnessForm = z.object({
  add_common_name: checkbox,
  add_scientific_name: checkbox,
});
