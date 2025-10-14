import { z } from "zod";

export const submissionNoteForm = z.object({
  note_text: z
    .string()
    .min(1, "Note cannot be empty")
    .max(2000, "Note too long (max 2000 characters)")
    .trim(),
});

export type SubmissionNoteFormValues = z.infer<typeof submissionNoteForm>;
