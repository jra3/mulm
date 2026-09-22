import { z } from "zod";
import { pointClassField } from "./pointClass";

/**
 * The create-Species form
 * Used when creating a new Species from the witness panel, which binds the Submission to it
 */
export const speciesCreateForm = z.object({
  canonical_genus: z.string().trim().min(1, "Genus cannot be empty").max(100),
  canonical_species_name: z.string().trim().min(1, "Species name cannot be empty").max(100),
  program_class: z.string().trim().min(1, "Program class cannot be empty").max(100),
  species_type: z.enum(["Fish", "Plant", "Invert", "Coral"], {
    error: "Species type must be Fish, Plant, Invert, or Coral",
  }),
  base_points: pointClassField,
  is_cares_species: z
    .string()
    .optional()
    .transform((val) => val === "on"),
});

export type SpeciesCreateFormValues = z.infer<typeof speciesCreateForm>;
