// Money in integer minor units (ADR-014, FR-DEAL-001). No floating-point arithmetic: amounts
// are parsed and formatted as decimal strings.

export const MAX_MINOR_AMOUNT = 10_000_000_000_000; // 10^13

/** ISO 4217 allowlist (subset; extend as instances need). */
export const CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "INR",
  "AUD",
  "CAD",
  "SGD",
  "AED",
  "JPY",
  "CHF",
  "NZD",
  "ZAR",
  "BRL",
  "MXN",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "HKD",
  "KWD",
] as const;
export type Currency = (typeof CURRENCIES)[number];

export function isCurrency(value: unknown): value is Currency {
  return typeof value === "string" && (CURRENCIES as readonly string[]).includes(value);
}

/** Number of minor-unit digits (JPY 0, USD 2, KWD 3). */
export function currencyDigits(currency: string): number {
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
    .maximumFractionDigits as number;
}

export const MONEY_INPUT_PATTERN = /^\d{1,13}([.,]\d{1,3})?$/;

/**
 * Parse a user-entered decimal ("1234.5", "1234,50") into minor units. Returns null for
 * malformed input, too many decimals for the currency, or amounts above 10^13 minor units.
 */
export function parseMoney(input: string, currency: string): number | null {
  const value = input.trim().replace(/[\s_]/g, "");
  if (!MONEY_INPUT_PATTERN.test(value)) return null;
  const [whole = "0", fraction = ""] = value.split(/[.,]/);
  const digits = currencyDigits(currency);
  if (fraction.length > digits) return null;
  const minor = Number(whole + fraction.padEnd(digits, "0"));
  if (!Number.isSafeInteger(minor) || minor > MAX_MINOR_AMOUNT) return null;
  return minor;
}

/** Minor units → plain decimal string ("1234.50"), suitable for an input's value. */
export function minorToDecimalString(minor: number, currency: string): string {
  const digits = currencyDigits(currency);
  const raw = String(Math.trunc(Math.abs(minor))).padStart(digits + 1, "0");
  const whole = raw.slice(0, raw.length - digits);
  const fraction = raw.slice(raw.length - digits);
  return `${minor < 0 ? "-" : ""}${whole}${digits ? `.${fraction}` : ""}`;
}

/** Locale-aware currency display; Intl accepts decimal strings, so no float conversion. */
export function formatMoney(minor: number, currency: string, locale: string): string {
  const decimal = minorToDecimalString(minor, currency);
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
    decimal as unknown as number,
  );
}
