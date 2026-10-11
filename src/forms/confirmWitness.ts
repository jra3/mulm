import { z } from "zod";
import { refineProgramBonuses } from "@/points";
import { isPointClass, pointClasses } from "@/species";
import { formCheckbox } from "./formBoolean";

const namesCheckbox = formCheckbox({ error: "Unexpected value for a Name to add" });

const pointClassList = `${pointClasses.slice(0, -1).join(", ")} or ${pointClasses[pointClasses.length - 1]}`;

/** The article bonus as the panel's radios post it: None, +5 or +10. */
const articlePoints = z
  .string()
  .optional()
  .transform((val) => (val === undefined || val === "" ? 0 : Number(val)))
  .refine((val) => val === 0 || val === 5 || val === 10, {
    message: "The article bonus is None, 5 or 10",
  })
  .transform((val) => (val === 0 ? null : val));

const confirmWitnessFields = z.object({
  /** The Species the witness settled on: the one bound, or the one chosen instead. */
  species_id: z.coerce
    .number({ error: "Choose the Species first" })
    .int()
    .positive("Choose the Species first"),
  /** The base points, one of the Point classes. */
  points: z.coerce
    .number({ error: "Choose the base points" })
    .refine((val) => isPointClass(val), { message: `Base points must be ${pointClassList}` }),
  article_points: articlePoints,
  cares_species: formCheckbox(),
  flowered: formCheckbox(),
  sexual_reproduction: formCheckbox(),
  add_common_name: namesCheckbox,
  add_scientific_name: namesCheckbox,
});

/**
 * The witness panel's confirm form for a Submission in `program`: the Species,
 * the base points and every bonus but first-time, which approval computes, and
 * which of the Submission's spellings become Names. The per-program bonus rule
 * from src/points.ts rides along, as it does on the approval form: CARES on
 * BAP only, flowered and sexual reproduction on HAP only. There is no
 * program-less export, because a schema that does not know the program cannot
 * tell a bonus that applies from one that does not.
 */
export function confirmWitnessSchema(program: string) {
  return confirmWitnessFields.superRefine(refineProgramBonuses(program));
}

export type ConfirmWitnessFormValues = z.infer<ReturnType<typeof confirmWitnessSchema>>;

/**
 * The same form as the panel is filling it in, for the sticky bar's sum: the
 * Species may still be unsettled and the base points unchosen, so both are
 * optional here, and a value outside the Point classes reads as unchosen
 * rather than refused. Nothing is written from this.
 */
export const witnessSummaryForm = z.object({
  species_id: z.coerce.number().int().positive().optional(),
  species_settled: z
    .string()
    .optional()
    .transform((val) => val === "1"),
  points: z
    .string()
    .optional()
    .transform((val) => (val === undefined || val === "" ? null : Number(val)))
    .transform((val) => (isPointClass(val) ? val : null)),
  article_points: articlePoints,
  cares_species: formCheckbox(),
  flowered: formCheckbox(),
  sexual_reproduction: formCheckbox(),
});

export type WitnessSummaryFormValues = z.infer<typeof witnessSummaryForm>;
