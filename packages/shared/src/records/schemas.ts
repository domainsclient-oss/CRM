import { z } from "zod";
import { MONEY_INPUT_PATTERN } from "./money";
import { MAX_TAGS_PER_RECORD, TAG_PATTERN, normalizeDomain, normalizeTag } from "./normalize";
import { DATE_PATTERN, TIME_PATTERN, isValidDate } from "./time";

// Record inputs (requirements/01 §6–11, §23). Forms send strings; empty optional fields become
// null. The server parses strictly (unknown keys rejected) and is authoritative.

export const ENTITY_TYPES = ["company", "contact", "lead", "deal", "task"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const INDUSTRIES = [
  "technology",
  "finance",
  "healthcare",
  "education",
  "manufacturing",
  "retail",
  "real_estate",
  "media",
  "professional_services",
  "hospitality",
  "nonprofit",
  "government",
  "other",
] as const;
export const SIZE_BANDS = ["1-10", "11-50", "51-200", "201-1000", "1000+"] as const;
export const LIFECYCLE_STAGES = [
  "subscriber",
  "lead",
  "opportunity",
  "customer",
  "churned",
  "other",
] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];
export const LEAD_SOURCES = [
  "website",
  "referral",
  "event",
  "outbound",
  "import",
  "other",
] as const;
export const LEAD_STATUSES = ["new", "contacted", "qualified", "unqualified", "converted"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
/** `converted` is set only by conversion (FR-LEAD-001). */
export const EDITABLE_LEAD_STATUSES = ["new", "contacted", "qualified", "unqualified"] as const;
export const DEAL_STATUSES = ["open", "won", "lost"] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];
export const LOST_REASONS = [
  "price",
  "competitor",
  "no_budget",
  "no_decision",
  "timing",
  "other",
] as const;
export const TASK_PRIORITIES = ["low", "normal", "high"] as const;
export const TASK_STATUSES = ["open", "done"] as const;
export const ACTIVITY_TYPES = ["call", "meeting", "email", "note"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number] | "system";
export const PHONE_LABELS = ["work", "mobile", "home", "other"] as const;
export const RELATED_TYPES = ["company", "contact", "lead", "deal"] as const;
export type RelatedType = (typeof RELATED_TYPES)[number];

const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const emptyToNull = (v: unknown) =>
  v === undefined || (typeof v === "string" && v.trim() === "") ? null : v;

export const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "Invalid reference");

/** Required short text: trim, NFC, 1–max chars, no control characters. */
export const requiredText = (max = 120) =>
  z
    .string()
    .trim()
    .normalize("NFC")
    .min(1, "Required")
    .max(max, `Use at most ${max} characters`)
    .refine((s) => !/[\u0000-\u001f\u007f]/.test(s), "Invalid characters");

/** Optional text: "" → null. Multi-line allowed for long text. */
export const optionalText = (max = 120, multiline = false) =>
  z.preprocess(
    emptyToNull,
    z
      .string()
      .trim()
      .normalize("NFC")
      .max(max, `Use at most ${max} characters`)
      .refine(
        (s) => !(multiline ? CONTROL_CHARS : /[\u0000-\u001f\u007f]/).test(s),
        "Invalid characters",
      )
      .nullable(),
  );

const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess(emptyToNull, z.enum(values).nullable());

const optionalId = z.preprocess(emptyToNull, idSchema.nullable());

export const optionalEmail = z.preprocess(
  emptyToNull,
  z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid email")).nullable(),
);

export const phoneSchema = z
  .string()
  .trim()
  .max(32, "Use at most 32 characters")
  .regex(/^\+?[\d\s()-]{3,}$/, "Use digits, spaces, + - ( )");
export const optionalPhone = z.preprocess(emptyToNull, phoneSchema.nullable());

export const optionalUrl = z.preprocess(
  emptyToNull,
  z
    .string()
    .trim()
    .max(2048)
    .refine((s) => {
      try {
        const u = new URL(s);
        return u.protocol === "https:" || u.protocol === "http:";
      } catch {
        return false;
      }
    }, "Use a full http(s):// address")
    .nullable(),
);

export const optionalDomain = z.preprocess(
  emptyToNull,
  z
    .string()
    .trim()
    .max(253)
    .refine((s) => normalizeDomain(s) !== null, "Enter a domain like example.com")
    .nullable(),
);

/** Decimal money string; converted to minor units server-side with the record's currency. */
export const optionalMoney = z.preprocess(
  emptyToNull,
  z.string().trim().regex(MONEY_INPUT_PATTERN, "Enter an amount like 1250.00").nullable(),
);

export const optionalDate = z.preprocess(
  emptyToNull,
  z.string().regex(DATE_PATTERN).refine(isValidDate, "Enter a valid date").nullable(),
);
export const optionalTime = z.preprocess(
  emptyToNull,
  z.string().regex(TIME_PATTERN, "Enter a time like 14:30").nullable(),
);

export const tagsSchema = z
  .array(
    z
      .string()
      .transform(normalizeTag)
      .pipe(
        z
          .string()
          .min(1)
          .max(32, "Tags have at most 32 characters")
          .regex(TAG_PATTERN, "Letters, numbers, spaces, - and _ only"),
      ),
  )
  .max(MAX_TAGS_PER_RECORD, `At most ${MAX_TAGS_PER_RECORD} tags`)
  .transform((tags) => [...new Set(tags)])
  .default([]);

export const addressSchema = z
  .object({
    line1: optionalText(120),
    line2: optionalText(120),
    city: optionalText(80),
    region: optionalText(80),
    postalCode: optionalText(20),
    country: z.preprocess(
      (v) => (typeof v === "string" ? (v.trim() === "" ? null : v.trim().toUpperCase()) : v),
      z
        .string()
        .regex(/^[A-Z]{2}$/, "Use a 2-letter country code")
        .nullable(),
    ),
  })
  .strict();
export type Address = z.infer<typeof addressSchema>;

export const EMPTY_ADDRESS: Address = {
  line1: null,
  line2: null,
  city: null,
  region: null,
  postalCode: null,
  country: null,
};

/** Optimistic concurrency token: the `updatedAt` the editor loaded (ISO string). */
export const expectedUpdatedAtSchema = z.iso.datetime();

// ---- Entities ----

export const companyFields = {
  name: requiredText(120),
  domain: optionalDomain,
  industry: optionalEnum(INDUSTRIES),
  sizeBand: optionalEnum(SIZE_BANDS),
  phone: optionalPhone,
  website: optionalUrl,
  address: addressSchema.default(EMPTY_ADDRESS),
  description: optionalText(2000, true),
  ownerUid: optionalId,
  tags: tagsSchema,
};
export const companyInput = z.object(companyFields);
export type CompanyInput = z.infer<typeof companyInput>;

export const phoneEntrySchema = z
  .object({ label: z.enum(PHONE_LABELS), number: phoneSchema })
  .strict();

export const contactFields = {
  firstName: requiredText(80),
  lastName: optionalText(80),
  email: optionalEmail,
  phones: z.array(phoneEntrySchema).max(3, "At most 3 phone numbers").default([]),
  jobTitle: optionalText(120),
  companyId: optionalId,
  lifecycleStage: z.enum(LIFECYCLE_STAGES).default("lead"),
  leadSource: optionalEnum(LEAD_SOURCES),
  address: addressSchema.default(EMPTY_ADDRESS),
  doNotContact: z.boolean().default(false),
  notes: optionalText(2000, true),
  ownerUid: optionalId,
  tags: tagsSchema,
};
export const contactInput = z.object(contactFields);
export type ContactInput = z.infer<typeof contactInput>;

export const leadFields = {
  firstName: requiredText(80),
  lastName: optionalText(80),
  email: optionalEmail,
  phone: optionalPhone,
  companyName: optionalText(120),
  jobTitle: optionalText(120),
  source: z.enum(LEAD_SOURCES).default("other"),
  status: z.enum(EDITABLE_LEAD_STATUSES).default("new"),
  estimatedValue: optionalMoney,
  notes: optionalText(2000, true),
  ownerUid: optionalId,
  tags: tagsSchema,
};
export const leadInput = z.object(leadFields);
export type LeadInput = z.infer<typeof leadInput>;

export const dealFields = {
  name: requiredText(120),
  amount: optionalMoney,
  stageId: idSchema,
  expectedCloseDate: optionalDate,
  probability: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
    z.number().int("Use a whole number").min(0).max(100).nullable(),
  ),
  primaryContactId: optionalId,
  companyId: optionalId,
  ownerUid: optionalId,
  tags: tagsSchema,
};
export const dealInput = z.object(dealFields);
export type DealInput = z.infer<typeof dealInput>;

export const relatedRefSchema = z.object({ type: z.enum(RELATED_TYPES), id: idSchema }).strict();
export type RelatedRef = z.infer<typeof relatedRefSchema>;

export const taskFields = {
  title: requiredText(200),
  description: optionalText(2000, true),
  dueDate: optionalDate,
  dueTime: optionalTime,
  priority: z.enum(TASK_PRIORITIES).default("normal"),
  assigneeUid: optionalId,
  related: z
    .preprocess(
      (v) => (v && typeof v === "object" && "id" in v && !v.id ? null : v),
      relatedRefSchema.nullable(),
    )
    .default(null),
};
export const taskInput = z.object(taskFields).refine((t) => !t.dueTime || t.dueDate, {
  message: "Choose a date for this time",
  path: ["dueTime"],
});
export type TaskInput = z.infer<typeof taskInput>;

export const activityFields = {
  type: z.enum(ACTIVITY_TYPES),
  subject: requiredText(200),
  body: optionalText(10_000, true),
  occurredDate: z.string().regex(DATE_PATTERN).refine(isValidDate, "Enter a valid date"),
  occurredTime: z.string().regex(TIME_PATTERN, "Enter a time like 14:30"),
  durationMinutes: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
    z.number().int().min(0).max(1440).nullable(),
  ),
  outcome: optionalText(120),
  related: z.array(relatedRefSchema).min(1).max(4),
};
export const activityInput = z.object(activityFields);
export type ActivityInput = z.infer<typeof activityInput>;

export const lostInput = z.object({
  lostReason: z.enum(LOST_REASONS),
  lostReasonText: optionalText(500, true),
});

/** Pipeline stages editor (FR-DEAL-002): 2–15 open stages; Won/Lost are fixed. */
export const pipelineStagesInput = z
  .array(
    z
      .object({
        id: z.preprocess(emptyToNull, idSchema.nullable()),
        name: requiredText(40),
        probability: z.coerce.number().int().min(0).max(100),
      })
      .strict(),
  )
  .min(2, "Keep at least 2 open stages")
  .max(15, "At most 15 open stages");

// ---- Settings (FR-SET-001/002) ----

export const LOCALES = ["en-US", "en-GB", "en-IN", "en-AU", "de-DE", "fr-FR", "es-ES"] as const;
export const DATE_FORMATS = ["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"] as const;
export const WEEK_STARTS = ["monday", "sunday", "saturday"] as const;
export const THEMES = ["system", "light", "dark"] as const;
