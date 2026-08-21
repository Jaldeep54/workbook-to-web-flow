import { z } from "zod";

/**
 * Password policy, applied anywhere a password is set (login only checks the
 * value against the stored hash, so it deliberately has no policy).
 */
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be at most 128 characters")
  .refine((v) => /[a-z]/.test(v), "Password must contain a lowercase letter")
  .refine((v) => /[A-Z]/.test(v), "Password must contain an uppercase letter")
  .refine((v) => /\d/.test(v), "Password must contain a number");

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: passwordSchema,
});

export const updateProfileSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
});
