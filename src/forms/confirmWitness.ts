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
 * Absent when the witness is recording a new Species instead.
 */
export const chosenSpeciesForm = z.object({ species_id: speciesId.optional() });

const scientificNameMessage = "Give the scientific name as genus and species, like Poecilia reticulata";

/**
 * The Record new species step's fields (#522), as the panel posts them and
 * then carries them, hidden, to the confirm. Nothing is written from the
 * step itself: the Species is created in the Witness's transaction.
 */
const newSpeciesFields = {
  /** Genus, then the rest as the epithet, which may be several words (a sp. name). */
  new_scientific_name: z
    .string({ error: scientificNameMessage })
    .transform((val) => val.trim().split(/\s+/).filter(Boolean))
    .refine((words) => words.length >= 2, { message: scientificNameMessage }),
  new_common_name: z
    .string()
    .optional()
    .transform((val) => val?.trim() || null),
  new_point_class: z
    .string({ error: "Choose the Point class" })
    .refine((val) => val !== "", { message: "Choose the Point class" })
    .transform((val) => Number(val))
    .refine((val) => isPointClass(val), { message: `The Point class is ${pointClassList}` }),
  new_cares_species: formCheckbox(),
};

/** The record step's values in the transition's shape (`NewSpeciesAtWitness`). */
export const recordSpeciesForm = z.object(newSpeciesFields).transform((val) => ({
  canonicalGenus: val.new_scientific_name[0],
  canonicalSpeciesName: val.new_scientific_name.slice(1).join(" "),
  commonName: val.new_common_name,
  pointClass: val.new_point_class,
  isCaresSpecies: val.new_cares_species,
}));

export type RecordSpeciesFormValues = z.infer<typeof recordSpeciesForm>;

/**
 * The record step's fields as typed, for echoing a refused step back with its
 * values in place: no rule applied, so nothing is lost on the way back.
 */
export const recordSpeciesDraftForm = z.object({
  new_scientific_name: z.string().optional().default(""),
  new_common_name: z.string().optional().default(""),
  new_point_class: z
    .string()
    .optional()
    .transform((val) => (val === undefined || val === "" ? null : Number(val))),
  new_cares_species: formCheckbox(),
});

/** Whether a confirm body carries a new Species: the record step's fields are present. */
function recordsNewSpecies(body: { new_scientific_name?: string }): boolean {
  return body.new_scientific_name !== undefined;
}

/**
 * What the Witness sets, as the panel posts it (#521, #522): the Species, as
 * `species_id` or as the record step's fields, the base points and every
 * bonus but first-time. The correction form (#528) posts the same fields,
 * so both schemas are built from these.
 */
export const witnessPointsFields = {
  species_id: speciesId.optional(),
  new_scientific_name: z.string().optional(),
  new_common_name: z.string().optional(),
  new_point_class: z.string().optional(),
  new_cares_species: z.string().optional(),
  /** The base points, one of the Point classes. */
  points: z.coerce
    .number({ error: "Choose the base points" })
    .refine((val) => isPointClass(val), { message: `Base points must be ${pointClassList}` }),
  article_points: articlePoints,
  cares_species: formCheckbox(),
  flowered: formCheckbox(),
  sexual_reproduction: formCheckbox(),
};

type WitnessPointsInput = z.infer<z.ZodObject<typeof witnessPointsFields>>;

/**
 * Settle the Species the fields name: exactly one of `species_id` and the
 * record step's fields, the latter parsed into a `NewSpeciesAtWitness`. The
 * transform both the confirm and the correction run; `rest` carries the
 * form's other fields through untouched.
 */
export function settleSpeciesFields<T extends WitnessPointsInput>(val: T, ctx: z.RefinementCtx) {
  const { species_id, new_scientific_name, new_common_name, new_point_class, new_cares_species, ...rest } = val;
  if (recordsNewSpecies(val)) {
    if (species_id !== undefined) {
      ctx.addIssue({ code: "custom", path: ["species_id"], message: "Choose a Species or record a new one, not both" });
      return z.NEVER;
    }
    const recorded = recordSpeciesForm.safeParse({ new_scientific_name, new_common_name, new_point_class, new_cares_species });
    if (!recorded.success) {
      for (const issue of recorded.error.issues) {
        ctx.addIssue({ code: "custom", path: [...issue.path], message: issue.message });
      }
      return z.NEVER;
    }
    return { ...rest, species_id: undefined, new_species: recorded.data };
  }
  if (species_id === undefined) {
    ctx.addIssue({ code: "custom", path: ["species_id"], message: "Choose the Species first" });
    return z.NEVER;
  }
  return { ...rest, species_id, new_species: undefined };
}

const confirmWitnessFields = z
  .object({
    ...witnessPointsFields,
    add_common_name: namesCheckbox,
    add_scientific_name: namesCheckbox,
  })
  .transform(settleSpeciesFields);

/**
 * The witness panel's confirm form: the Species, the base points and every
 * bonus but first-time, which approval computes, and which of the
 * Submission's spellings become Names. The per-program bonus rule from
 * src/points.ts rides along, as it does on the approval form: CARES on BAP
 * only, flowered and sexual reproduction on HAP only.
 *
 * The Species is either `species_id`, one the catalogue holds, or
 * `new_species`, one the witness is recording (#522), carried as the record
 * step's fields; exactly one of the two.
 *
 * `program` is the Program the Submission will have once confirmed, which is
 * the chosen Species' Program, not necessarily the one the member filed under:
 * the confirm adopts the Species' Program, and the bonus rule has to be judged
 * against that one. For a new Species that is the Submission's own, since the
 * Species takes the Submission's type. `confirmWitness` checks the same rule
 * again against the Species it resolves, so this schema is the panel's early
 * word, not the only one. There is no program-less export, because a schema
 * that does not know the program cannot tell a bonus that applies from one
 * that does not.
 */
export function confirmWitnessSchema(program: string) {
  return confirmWitnessFields.superRefine(refineProgramBonuses(program));
}

export type ConfirmWitnessFormValues = z.infer<ReturnType<typeof confirmWitnessSchema>>;

/**
 * The same form as the panel is filling it in, for the sticky bar's sum: the
 * Species may still be unsettled and the base points unchosen, so both are
 * optional here, and a value outside the Point classes reads as unchosen
 * rather than refused. A new Species being recorded counts as a Species
 * chosen. Nothing is written from this.
 */
export const witnessSummaryForm = z.object({
  species_id: z.coerce.number().int().positive().optional(),
  new_scientific_name: z
    .string()
    .optional()
    .transform((val) => Boolean(val && val.trim())),
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
  /** The correction form's first-time switch (#528), offered on Approved Submissions only. */
  first_time_species: formCheckbox(),
  /** Whether the bar belongs to the correction form, whose button saves rather than confirms. */
  correction: z
    .string()
    .optional()
    .transform((val) => val === "1"),
});

export type WitnessSummaryFormValues = z.infer<typeof witnessSummaryForm>;
