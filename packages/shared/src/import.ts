// CSV import field definitions and column auto-mapping (FR-IMP-001). Each import field maps a CSV
// column to one input field of the entity's schema; values are validated by the same schemas as
// the forms (server-authoritative).

export const IMPORT_ENTITIES = ["contacts", "companies", "leads"] as const;
export type ImportEntity = (typeof IMPORT_ENTITIES)[number];

export const IMPORT_LIMITS = { maxBytes: 10 * 1024 * 1024, maxRows: 10_000, chunkSize: 500 };

export const DUPLICATE_MODES = ["skip", "update", "create"] as const;
export type DuplicateMode = (typeof DUPLICATE_MODES)[number];

/** field → header synonyms (normalized: lowercase, alphanumerics only). */
export const IMPORT_FIELDS: Record<ImportEntity, Record<string, string[]>> = {
  contacts: {
    firstName: ["firstname", "first", "givenname", "name"],
    lastName: ["lastname", "last", "surname", "familyname"],
    email: ["email", "emailaddress", "mail"],
    phone: ["phone", "phonenumber", "mobile", "tel", "telephone"],
    jobTitle: ["jobtitle", "title", "position", "role"],
    lifecycleStage: ["lifecyclestage", "stage", "lifecycle"],
    leadSource: ["leadsource", "source"],
    notes: ["notes", "note", "comments"],
    tags: ["tags", "labels"],
  },
  companies: {
    name: ["name", "company", "companyname", "organization", "organisation"],
    domain: ["domain", "domainname"],
    website: ["website", "url", "web", "site"],
    phone: ["phone", "phonenumber", "tel"],
    industry: ["industry", "sector"],
    sizeBand: ["size", "sizeband", "employees", "companysize"],
    city: ["city", "town"],
    country: ["country", "countrycode"],
    description: ["description", "about", "notes"],
    tags: ["tags", "labels"],
  },
  leads: {
    firstName: ["firstname", "first", "givenname", "name"],
    lastName: ["lastname", "last", "surname"],
    email: ["email", "emailaddress", "mail"],
    phone: ["phone", "phonenumber", "mobile", "tel"],
    companyName: ["company", "companyname", "organization", "organisation"],
    jobTitle: ["jobtitle", "title", "position"],
    source: ["source", "leadsource"],
    status: ["status", "leadstatus"],
    estimatedValue: ["estimatedvalue", "value", "amount", "dealvalue"],
    notes: ["notes", "note", "comments"],
    tags: ["tags", "labels"],
  },
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Suggest a field per column (each field used at most once; unknown columns are skipped). */
export function suggestMapping(header: string[], entity: ImportEntity): Array<string | null> {
  const used = new Set<string>();
  const fields = IMPORT_FIELDS[entity];
  // Exact field-name matches first, then synonyms, so "First name" beats "Name".
  const pick = (column: string, exactOnly: boolean): string | null => {
    const n = norm(column);
    for (const [field, synonyms] of Object.entries(fields)) {
      if (used.has(field)) continue;
      if (norm(field) === n || (!exactOnly && synonyms.includes(n))) return field;
    }
    return null;
  };
  const result: Array<string | null> = header.map((c) => {
    const f = pick(c, true);
    if (f) used.add(f);
    return f;
  });
  return result.map((f, i) => {
    if (f) return f;
    const g = pick(header[i]!, false);
    if (g) used.add(g);
    return g;
  });
}

/** Mapped CSV row → schema input for the entity (raw strings; the schema validates/normalizes). */
export function rowToInput(
  entity: ImportEntity,
  row: string[],
  mapping: Array<string | null>,
): Record<string, unknown> {
  const v: Record<string, string> = {};
  mapping.forEach((field, i) => {
    if (field) v[field] = (row[i] ?? "").trim();
  });
  const tags = v.tags
    ? v.tags
        .split(/[;,|]/)
        .map((t) => t.trim())
        .filter(Boolean)
    : [];
  switch (entity) {
    case "contacts":
      return {
        firstName: v.firstName ?? "",
        lastName: v.lastName ?? "",
        email: v.email ?? "",
        phones: v.phone ? [{ label: "work", number: v.phone }] : [],
        jobTitle: v.jobTitle ?? "",
        ...(v.lifecycleStage ? { lifecycleStage: v.lifecycleStage.toLowerCase() } : {}),
        leadSource: (v.leadSource ?? "").toLowerCase(),
        notes: v.notes ?? "",
        tags,
      };
    case "companies":
      return {
        name: v.name ?? "",
        domain: v.domain ?? "",
        website: v.website ?? "",
        phone: v.phone ?? "",
        industry: (v.industry ?? "").toLowerCase().replace(/\s+/g, "_"),
        sizeBand: v.sizeBand ?? "",
        address: {
          line1: "",
          line2: "",
          city: v.city ?? "",
          region: "",
          postalCode: "",
          country: v.country ?? "",
        },
        description: v.description ?? "",
        tags,
      };
    case "leads":
      return {
        firstName: v.firstName ?? "",
        lastName: v.lastName ?? "",
        email: v.email ?? "",
        phone: v.phone ?? "",
        companyName: v.companyName ?? "",
        jobTitle: v.jobTitle ?? "",
        ...(v.source ? { source: v.source.toLowerCase() } : {}),
        ...(v.status ? { status: v.status.toLowerCase() } : {}),
        estimatedValue: v.estimatedValue ?? "",
        notes: v.notes ?? "",
        tags,
      };
  }
}
