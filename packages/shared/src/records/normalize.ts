// Normalizers shared by forms, services, and duplicate checks (requirements/01 §23, 03 §9.2).

/** NFKD, strip diacritics, lowercase — the search/sort form of a string. */
export function foldText(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

/** FR-CON-003: trim + lowercase. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * FR-COM-003: lowercase, strip protocol, path, port, and a leading "www.". Returns null when
 * nothing domain-like is left. Never fetched server-side (SSRF).
 */
export function normalizeDomain(input: string): string | null {
  let value = input.trim().toLowerCase();
  if (!value) return null;
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  value = value.split(/[/?#]/)[0] ?? "";
  value = value.replace(/^[^@]*@/, "").replace(/:\d+$/, "");
  value = value.replace(/^www\./, "").replace(/\.$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value) ? value : null;
}

export const TAG_PATTERN = /^[\p{L}\p{N} _-]+$/u;
export const MAX_TAGS_PER_RECORD = 20;
export const MAX_TAG_CATALOG = 500;

/** FR-REC-002: tags compare case-insensitively; stored lowercase with collapsed spaces. */
export function normalizeTag(tag: string): string {
  return tag.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Firestore-safe document ID for a normalized tag (deterministic, no slashes). */
export function tagId(normalized: string): string {
  let hash = 0x811c9dc5;
  for (const ch of normalized) {
    hash ^= ch.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const readable = foldText(normalized)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${readable || "tag"}-${hash.toString(36)}`;
}

/**
 * Prefix search tokens (03 §9.2, ADR-010): words ≥ 2 chars from the given fields, prefixes of
 * length 2..15, at most 10 words and 60 tokens per document.
 */
export function buildSearchTokens(fields: Array<string | null | undefined>): string[] {
  const words = fields
    .filter((f): f is string => typeof f === "string" && f.length > 0)
    .flatMap((f) => foldText(f).split(/[\s@._\-/,;:()'"]+/))
    .filter((w) => w.length >= 2);
  const tokens = new Set<string>();
  for (const word of [...new Set(words)].slice(0, 10)) {
    for (let i = 2; i <= Math.min(word.length, 15); i++) tokens.add(word.slice(0, i));
  }
  return [...tokens].slice(0, 60);
}
