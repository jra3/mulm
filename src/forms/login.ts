import * as z from "zod"

export const loginSchema = z.object({
  email: z.string(),
  password: z.string(),
  rememberMe: z.boolean().optional(),
})

export const signupSchema = z.object({
  email: z.string().email(),
  display_name: z.string().min(2, "Too short"),
  password: z.string(),
  password_confirm: z.string(),
}).refine(
  (data) => (data.password_confirm === data.password),
  {
    message: "Passwords do not match.",
    path: ["password_confirm"],
  }
)

export const updateSchema = z.object({
  email: z.string().email(),
  display_name: z.string().min(2, "Too short"),
  current_password: z.string().optional(),
  password: z.string().optional(),
  password_confirm: z.string(),
}).refine(
  (data) => (data.password_confirm === data.password),
  {
    message: "Passwords do not match.",
    path: ["password_confirm"],
  }
)

export const forgotSchema = z.object({
  email: z.string().email(),
});

export const resetSchema = z.object({
  code: z.string(),
  password: z.string(),
  password_confirm: z.string(),
}).refine(
  (data) => (data.password_confirm === data.password),
  {
    message: "Passwords do not match.",
    path: ["password_confirm"],
  }
);


export type LoginFormValues = z.infer<typeof loginSchema>;
export type SignupFormValues = z.infer<typeof signupSchema>;

