import { z } from "zod";

/**
 * Species group creation form validation
 * Used when creating a new species from the approval panel
 */
export const speciesCreateForm = z.object({
  canonical_genus: z.string().trim().min(1, "Genus cannot be empty").max(100),
  canonical_species_name: z.string().trim().min(1, "Species name cannot be empty").max(100),
  program_class: z.string().trim().min(1, "Program class cannot be empty").max(100),
  species_type: z.enum(["Fish", "Plant", "Invert", "Coral"], {
    errorMap: () => ({ message: "Species type must be Fish, Plant, Invert, or Coral" }),
  }),
  base_points: z
    .string()
    .optional()
    .transform((val) => {
      if (!val || val === "") return null;
      const num = parseInt(val, 10);
      if (![5, 10, 15, 20].includes(num)) {
        throw new Error("Base points must be 5, 10, 15, or 20");
      }
      return num;
    }),
  is_cares_species: z
    .string()
    .optional()
    .transform((val) => val === "on"),
});

export type SpeciesCreateFormValues = z.infer<typeof speciesCreateForm>;
