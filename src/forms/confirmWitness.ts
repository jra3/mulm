import { z } from "zod";
import { articleBonuses, refineProgramBonuses } from "@/points";
import { isPointClass, pointClasses } from "@/species";
import { formCheckbox } from "./formBoolean";

const namesCheckbox = formCheckbox({ error: "Unexpected value for a Name to add" });

const pointClassList = `${pointClasses.slice(0, -1).join(", ")} or ${pointClasses[pointClasses.length - 1]}`;

/** The article bonus as the panel's radios post it: None, +5 or +10. */
const articlePoints = z
  .string()
  .optional()
  .transform((val) => (val === undefined || val === "" ? 0 : Number(val)))
  .refine((val) => val === 0 || articleBonuses.includes(val), {
    message: `The article bonus is None, ${articleBonuses.join(" or ")}`,
  })
  .transform((val) => (val === 0 ? null : val));

/** The Species the witness settled on: the one bound, or the one chosen instead. */
const speciesId = z.coerce
  .number({ error: "Choose the Species first" })
  .int()
  .positive("Choose the Species first");

/**
 * Just the Species from the confirm form, read ahead of the rest: the route
 * validates the bonuses against that Species' Program, since the confirm
 * gives the Submission the Species' Program (see `confirmWitnessSchema`).
 */
export const chosenSpeciesForm = z.object({ species_id: speciesId });

const confirmWitnessFields = z.object({
  species_id: speciesId,
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
 * The witness panel's confirm form: the Species, the base points and every
 * bonus but first-time, which approval computes, and which of the
 * Submission's spellings become Names. The per-program bonus rule from
 * src/points.ts rides along, as it does on the approval form: CARES on BAP
 * only, flowered and sexual reproduction on HAP only.
 *
 * `program` is the Program the Submission will have once confirmed, which is
 * the chosen Species' Program, not necessarily the one the member filed under:
 * the confirm adopts the Species' Program, and the bonus rule has to be judged
 * against that one. `confirmWitness` checks the same rule again against the
 * Species it resolves, so this schema is the panel's early word, not the
 * only one. There is no program-less export, because a schema that does not
 * know the program cannot tell a bonus that applies from one that does not.
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
