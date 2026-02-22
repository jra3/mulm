import * as z from "zod";

/**
 * Schema for CARES registration - validates the collection entry ID
 * Photo is validated separately by multer
 */
export const caresRegistrationSchema = z.object({
  collection_entry_id: z.coerce
    .number({
      required_error: "Collection entry ID is required",
      invalid_type_error: "Collection entry ID must be a number",
    })
    .int()
    .positive("Collection entry ID must be positive"),
});

export type CaresRegistrationInput = z.infer<typeof caresRegistrationSchema>;
