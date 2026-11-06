import { en, type MessageKey } from "./messages/en";
import { interpolate } from "./i18n-base";

export type { MessageKey };
export { errorMessage } from "./i18n-base";

type Vars = Record<string, string | number>;

/**
 * Look up a user-facing string. English only in MVP (A-07); the catalog shape
 * allows adding locales later without changing call sites.
 * Unknown placeholders are left as-is so missing values are visible in review.
 */
export function t(key: MessageKey, vars?: Vars): string {
  return interpolate(en[key], vars);
}
