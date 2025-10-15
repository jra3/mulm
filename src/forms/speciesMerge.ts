import * as z from "zod";

export const mergeSpeciesSchema = z
  .object({
    defunct_group_id: z
      .string()
      .min(1, "Defunct species required")
      .transform((val) => parseInt(val)),
    canonical_group_id: z
      .string()
      .min(1, "Canonical species required")
      .transform((val) => parseInt(val)),
    confirm: z
      .string()
      .optional()
      .transform((val) => val === "on" || val === "true"),
  })
  .refine((data) => data.defunct_group_id !== data.canonical_group_id, {
    message: "Cannot merge a species into itself",
    path: ["canonical_group_id"],
  })
  .refine((data) => data.confirm === true, {
    message: "You must confirm this action",
    path: ["confirm"],
  });

export type MergeSpeciesFormValues = z.infer<typeof mergeSpeciesSchema>;
