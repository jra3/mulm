import * as z from "zod"

export const memberSchema = z.object({
  display_name: z.string().min(1, "Required").max(100, "Name too long (max 100 characters)"),
  contact_email: z.string().email("Valid address required").max(100, "Email too long (max 100 characters)"),
  is_admin: z.string().max(10, "Value too long").optional(),
  fish_level: z.string().max(50, "Level too long").optional(),
  plant_level: z.string().max(50, "Level too long").optional(),
  coral_level: z.string().max(50, "Level too long").optional(),
});

export const inviteSchema = z.object({
  contact_email: z.string().email("Valid address required").max(100, "Email too long (max 100 characters)"),
  display_name: z.string().max(100, "Name too long (max 100 characters)").optional(),
});
