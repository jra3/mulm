import { z } from "zod";
import { refineProgramBonuses } from "@/points";
import { settleSpeciesFields, witnessPointsFields } from "./confirmWitness";

/**
 * The correction form (#528): the witness panel's Species and Points fields
 * (`witnessPointsFields`), a required reason, and on an Approved Submission
 * the first-time switch. Everything the Witness set may change, and the
 * reason goes on the changelog with it.
 *
 * `program` is the Program the Submission will have once corrected, the
 * chosen Species' Program, which the per-program bonus rule (src/points.ts)
 * is judged against; `correctPoints` judges it again against the Species it
 * resolves. `approved` says whether first-time may be posted at all: before
 * approval it is NULL and approval decides it, so a value is refused rather
 * than dropped, in case a stale form posts one.
 */
export function correctPointsSchema(program: string, options: { approved: boolean }) {
  return z
    .object({
      ...witnessPointsFields,
      first_time_species: z.string().optional(),
      reason: z
        .string({ error: "Say why the points are being corrected" })
        .trim()
        .min(3, "Say why the points are being corrected (at least 3 characters)")
        .max(2000),
    })
    .transform((val, ctx) => {
      const { first_time_species, ...rest } = val;
      if (!options.approved && first_time_species !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["first_time_species"],
          message: "First-time is decided at approval; it cannot be set before then",
        });
        return z.NEVER;
      }
      const settled = settleSpeciesFields(rest, ctx);
      if (settled === z.NEVER) return z.NEVER;
      return { ...settled, first_time_species: options.approved ? first_time_species === "on" : undefined };
    })
    .superRefine(refineProgramBonuses(program));
}

export type CorrectPointsFormValues = z.infer<ReturnType<typeof correctPointsSchema>>;
