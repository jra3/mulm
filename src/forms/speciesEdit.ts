import { z } from "zod";
import { pointClassField } from "./pointClass";

/**
 * The admin Species edit form
 */
export const speciesEditForm = z.object({
  canonical_genus: z.string().trim().min(1, "Genus cannot be empty").max(100),
  canonical_species_name: z.string().trim().min(1, "Species name cannot be empty").max(100),
  program_class: z.string().trim().min(1, "Program class cannot be empty").max(100),
  base_points: pointClassField,
  is_cares_species: z
    .string()
    .optional()
    .transform((val) => val === "on"),
  external_references: z
    .string()
    .optional()
    .transform((val) => {
      if (!val || val.trim() === "") return [];
      return val
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    }),
  image_links: z
    .string()
    .optional()
    .transform((val) => {
      if (!val || val.trim() === "") return [];
      return val
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    }),
});

export type SpeciesEditFormValues = z.infer<typeof speciesEditForm>;
