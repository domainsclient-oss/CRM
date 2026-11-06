import { enBase, type BaseMessageKey } from "./messages/en-base";
import type { ErrorCode } from "./errors";

// Lightweight lookup over the base messages only (error boundaries, 404, public forms), so
// client bundles that need just these don't include the full catalog (TC-PERF-001).
// Same behaviour as `t` in ./i18n.

type Vars = Record<string, string | number>;

export function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(vars, name) ? String(vars[name]) : match,
  );
}

export function tBase(key: BaseMessageKey, vars?: Vars): string {
  return interpolate(enBase[key], vars);
}

export function errorMessage(code: ErrorCode): string {
  return tBase(`error.${code}`);
}
