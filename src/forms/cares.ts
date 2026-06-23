import * as z from "zod";

/**
 * Schema for CARES registration - validates the collection entry ID
 * Photo is validated separately by multer
 */
export const caresRegistrationSchema = z.object({
  collection_entry_id: z.coerce
    .number({
      error: (iss) =>
        iss.input === undefined
          ? "Collection entry ID is required"
          : "Collection entry ID must be a number",
    })
    .int()
    .positive("Collection entry ID must be positive"),
});

export type CaresRegistrationInput = z.infer<typeof caresRegistrationSchema>;

/**
 * Schema for recording a fry share
 */
export const caresFryShareSchema = z.object({
  species_group_id: z.coerce
    .number({ error: "Species is required" })
    .int()
    .positive("Please select a species"),
  recipient_name: z
    .string({ error: "Recipient name is required" })
    .min(1, "Recipient name is required")
    .max(200, "Recipient name is too long"),
  recipient_club: z
    .string()
    .max(200, "Club name is too long")
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : null)),
  share_date: z
    .string({ error: "Date is required" })
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format"),
  notes: z
    .string()
    .max(500, "Notes are too long")
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : null)),
});

export type CaresFryShareInput = z.infer<typeof caresFryShareSchema>;
