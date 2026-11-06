import { z } from "zod";

// Shared validation for Phase 2 inputs (requirements/01 §23). Used by forms and,
// authoritatively, by the server (wrappers parse strictly).

export const RESERVED_SLUGS = [
  "www",
  "app",
  "api",
  "admin",
  "console",
  "partners",
  "assets",
  "auth",
  "mail",
  "status",
  "docs",
  "help",
  "support",
  "billing",
  "static",
  "cdn",
  "login",
  "signup",
  "t",
  "platform",
  "agency",
] as const;

/** FR-TEN-003: 3–40 chars, lowercase alphanumerics and single hyphens, not reserved. */
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/, "3–40 lowercase letters, numbers, or hyphens")
  .refine((s) => !s.includes("--"), "No consecutive hyphens")
  .refine((s) => !(RESERVED_SLUGS as readonly string[]).includes(s), "This name is reserved");

export const displayNameSchema = z
  .string()
  .trim()
  .normalize("NFC")
  .min(1, "Required")
  .max(120)
  .refine((s) => !/[\u0000-\u001f\u007f]/.test(s), "Invalid characters");

export const orgNameSchema = displayNameSchema.pipe(z.string().max(80));

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email("Enter a valid email"));

/** FR-AUTH-001: length-based policy (≥ 12, ≤ 128); paste and password managers allowed. */
export const passwordSchema = z
  .string()
  .min(12, "Use at least 12 characters")
  .max(128, "Use at most 128 characters");

/** Opaque tokens (invitations): 43-char base64url of 32 random bytes. */
export const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, "Invalid link");

export const idTokenSchema = z.string().min(20).max(4096);

export const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
