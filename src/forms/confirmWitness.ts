import { z } from "zod";
import { formCheckbox } from "./formBoolean";

const checkbox = formCheckbox({ error: "Unexpected value for a Name to add" });

/**
 * The witness panel's confirm form: which of the Submission's spellings the
 * witness adds to the bound Species as Names.
 */
export const confirmWitnessForm = z.object({
  add_common_name: checkbox,
  add_scientific_name: checkbox,
});
