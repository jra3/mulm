import * as z from "zod";
import { validatePasswordComplexity } from "../auth/passwordComplexity";

export const loginSchema = z.object({
  email: z.string().max(100, "Email too long (max 100 characters)"),
  password: z.string().max(100, "Password too long (max 100 characters)"),
  rememberMe: z.boolean().optional(),
})

export const signupSchema = z.object({
  email: z.string().email().max(100, "Email too long (max 100 characters)"),
  display_name: z.string().min(2, "Too short").max(100, "Name too long (max 100 characters)"),
  password: z.string()
    .max(100, "Password too long (max 100 characters)")
    .refine(
      (val) => validatePasswordComplexity(val).valid,
      (val) => ({ message: validatePasswordComplexity(val).errors[0] || "Invalid password" })
    ),
  password_confirm: z.string().max(100, "Password too long (max 100 characters)"),
}).refine(
  (data) => (data.password_confirm === data.password),
  {
    message: "Passwords do not match.",
    path: ["password_confirm"],
  }
)

export const updateSchema = z.object({
  email: z.string().email().max(100, "Email too long (max 100 characters)"),
  display_name: z.string().min(2, "Too short").max(100, "Name too long (max 100 characters)"),
  current_password: z.string().max(100, "Password too long (max 100 characters)").optional(),
  password: z.string()
    .max(100, "Password too long (max 100 characters)")
    .optional()
    .refine(
      (val) => !val || validatePasswordComplexity(val).valid,
      (val) => ({ message: val ? validatePasswordComplexity(val).errors[0] : undefined })
    ),
  password_confirm: z.string().max(100, "Password too long (max 100 characters)"),
}).refine(
  (data) => (data.password_confirm === data.password),
  {
    message: "Passwords do not match.",
    path: ["password_confirm"],
  }
)

export const forgotSchema = z.object({
  email: z.string().email().max(100, "Email too long (max 100 characters)"),
});

export const resetSchema = z.object({
  code: z.string().max(200, "Code too long"),
  password: z.string()
    .max(100, "Password too long (max 100 characters)")
    .refine(
      (val) => validatePasswordComplexity(val).valid,
      (val) => ({ message: validatePasswordComplexity(val).errors[0] || "Invalid password" })
    ),
  password_confirm: z.string().max(100, "Password too long (max 100 characters)"),
}).refine(
  (data) => (data.password_confirm === data.password),
  {
    message: "Passwords do not match.",
    path: ["password_confirm"],
  }
);


export type LoginFormValues = z.infer<typeof loginSchema>;
export type SignupFormValues = z.infer<typeof signupSchema>;

