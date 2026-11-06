import { z } from "zod";
import { HEX_COLOR } from "./theme";

// Branding and email-override inputs (FR-BRAND-001..003, requirements/05 §7). Null means
// "inherit from the level above" (platform → agency → workspace).

const emptyToNull = (v: unknown) =>
  v === undefined || (typeof v === "string" && v.trim() === "") ? null : v;

export const appNameSchema = z
  .string()
  .trim()
  .normalize("NFC")
  .min(1)
  .max(40, "Use at most 40 characters")
  .refine((s) => !/[\u0000-\u001f\u007f<>]/.test(s), "Invalid characters");

export const hexColorSchema = z
  .string()
  .trim()
  .regex(HEX_COLOR, "Use a 6-digit hex colour like #1F6FEB")
  .transform((s) => s.toUpperCase());

export const brandingInput = z.object({
  appName: z.preprocess(emptyToNull, appNameSchema.nullable()),
  primaryColor: z.preprocess(emptyToNull, hexColorSchema.nullable()),
  accentColor: z.preprocess(emptyToNull, hexColorSchema.nullable()),
});
export type BrandingInput = z.infer<typeof brandingInput>;

export const BRAND_ASSET_KINDS = ["logoLight", "logoDark", "favicon"] as const;
export type BrandAssetKind = (typeof BRAND_ASSET_KINDS)[number];

/** FR-BRAND-001 limits (SVG is never accepted in the MVP). */
export const BRAND_ASSET_LIMITS: Record<
  BrandAssetKind | "avatar",
  { maxBytes: number; maxSide: number; types: readonly ("png" | "jpeg" | "webp")[] }
> = {
  logoLight: { maxBytes: 1024 * 1024, maxSide: 2048, types: ["png", "jpeg", "webp"] },
  logoDark: { maxBytes: 1024 * 1024, maxSide: 2048, types: ["png", "jpeg", "webp"] },
  favicon: { maxBytes: 256 * 1024, maxSide: 512, types: ["png"] },
  avatar: { maxBytes: 512 * 1024, maxSide: 1024, types: ["png", "jpeg", "webp"] },
};

/** Brand asset paths: `{scope}/{sha256}.{ext}` where scope is `agency_<id>` or `tenant_<id>`. */
export const BRAND_ASSET_PATH =
  /^(agency|tenant)_[A-Za-z0-9_-]{1,64}\/[a-f0-9]{64}\.(png|jpg|webp)$/;

// ---- Email overrides (FR-BRAND-003) ----

export const OVERRIDABLE_EMAILS = [
  "workspace_invitation",
  "password_reset",
  "ownership_transferred",
] as const;
export type OverridableEmail = (typeof OVERRIDABLE_EMAILS)[number];

export const EMAIL_VARIABLES = ["tenant.name", "user.firstName", "inviter.name"] as const;

const VARIABLE = /\{\{\s*([a-zA-Z.]+)\s*\}\}/g;
const LINKISH = /(https?:\/\/|www\.|[a-z0-9-]+\.(com|net|org|io|co|in|app|dev)\b)/i;

/** Plain text, allowlisted variables only, no links or markup (anti-phishing, R-13). */
const overrideText = (max: number) =>
  z.preprocess(
    emptyToNull,
    z
      .string()
      .trim()
      .normalize("NFC")
      .max(max, `Use at most ${max} characters`)
      .refine((s) => !/[<>]/.test(s), "HTML isn't allowed")
      .refine((s) => !LINKISH.test(s), "Links aren't allowed")
      .refine(
        (s) =>
          [...s.matchAll(VARIABLE)].every((m) =>
            (EMAIL_VARIABLES as readonly string[]).includes(m[1]!),
          ),
        `Only ${EMAIL_VARIABLES.map((v) => `{{${v}}}`).join(", ")} can be used`,
      )
      .nullable(),
  );

export const emailOverrideInput = z.object({
  template: z.enum(OVERRIDABLE_EMAILS),
  subject: overrideText(120).refine((s) => s === null || !/[\r\n]/.test(s), "One line only"),
  intro: overrideText(500),
});
export type EmailOverrideInput = z.infer<typeof emailOverrideInput>;

/** Replace allowlisted `{{variables}}` with plain values (escaping happens at render). */
export function interpolate(text: string, values: Partial<Record<string, string>>): string {
  return text.replace(VARIABLE, (whole, name: string) =>
    (EMAIL_VARIABLES as readonly string[]).includes(name) ? (values[name] ?? "") : whole,
  );
}
