// Brand theme derivation with WCAG contrast safety (FR-BRAND-002, requirements/05 §4.1).
// Pure and isomorphic: the server derives the stored theme on save; the settings page uses the
// same function for live preview. Lightness adjustments happen in OKLCH so hue is preserved.

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export const SURFACE_LIGHT = "#FFFFFF";
export const SURFACE_DARK = "#0A0A0A"; // ≈ oklch(0.145 0 0), the dark --background token
const TEXT_LIGHT = "#FFFFFF";
const TEXT_DARK = "#111827";

export const MIN_TEXT_CONTRAST = 4.5;
export const MIN_UI_CONTRAST = 3;

type RGB = [number, number, number];

function parseHex(hex: string): RGB {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: RGB): string {
  const c = (v: number) =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

const toLinear = (v: number) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number) => {
  const s = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return s * 255;
};

export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map(toLinear) as RGB;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio (1–21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// ---- OKLCH (Björn Ottosson's OKLab) ----

function hexToOklch(hex: string): [number, number, number] {
  const [r, g, b] = parseHex(hex).map(toLinear) as RGB;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), Math.atan2(B, A)];
}

function oklchToHex(L: number, C: number, h: number): string {
  // Reduce chroma until the colour fits the sRGB gamut (keeps hue and lightness).
  for (let chroma = C; chroma >= 0; chroma -= 0.005) {
    const A = chroma * Math.cos(h);
    const B = chroma * Math.sin(h);
    const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
    const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
    const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
    const rgb = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
    if (rgb.every((v) => v >= -0.0001 && v <= 1.0001)) {
      return toHex(rgb.map((v) => fromLinear(Math.min(1, Math.max(0, v)))) as RGB);
    }
  }
  return toHex([L * 255, L * 255, L * 255]);
}

/**
 * Nearest colour (by OKLCH lightness, same hue) that satisfies `ok`, searching darker and
 * lighter in small steps. Returns null if no lightness works (cannot happen for contrast vs. a
 * pure white or near-black surface, but kept total).
 */
export function adjustLightness(hex: string, ok: (candidate: string) => boolean): string | null {
  if (ok(hex)) return hex.toUpperCase();
  const [L, C, h] = hexToOklch(hex);
  for (let step = 0.01; step <= 1; step += 0.01) {
    for (const next of [L - step, L + step]) {
      if (next < 0 || next > 1) continue;
      const candidate = oklchToHex(next, C, h);
      if (ok(candidate)) return candidate;
    }
  }
  return null;
}

function bestText(background: string): string {
  return contrast(TEXT_LIGHT, background) >= contrast(TEXT_DARK, background)
    ? TEXT_LIGHT
    : TEXT_DARK;
}

export interface DerivedTheme {
  primary: string;
  primaryFg: string;
  /** Primary used as text/links on the light surface (≥ 4.5:1). */
  primaryOnSurface: string;
  /** Primary used as text/links on the dark surface (≥ 4.5:1). */
  primaryOnSurfaceDark: string;
  /** Focus ring on light / dark surfaces (≥ 3:1, WCAG 1.4.11). */
  focusRing: string;
  focusRingDark: string;
  accent: string;
  accentFg: string;
}

export type ThemeResult =
  | { ok: true; theme: DerivedTheme }
  | { ok: false; field: "primaryColor" | "accentColor"; suggestion: string | null };

/** FR-BRAND-002: fails (with a suggested colour) when no compliant text colour exists. */
export function deriveTheme(primaryColor: string, accentColor: string): ThemeResult {
  const primary = primaryColor.toUpperCase();
  const accent = accentColor.toUpperCase();
  const primaryFg = bestText(primary);
  if (contrast(primaryFg, primary) < MIN_TEXT_CONTRAST) {
    return {
      ok: false,
      field: "primaryColor",
      suggestion: adjustLightness(primary, (c) => contrast(bestText(c), c) >= MIN_TEXT_CONTRAST),
    };
  }
  const accentFg = bestText(accent);
  if (contrast(accentFg, accent) < MIN_TEXT_CONTRAST) {
    return {
      ok: false,
      field: "accentColor",
      suggestion: adjustLightness(accent, (c) => contrast(bestText(c), c) >= MIN_TEXT_CONTRAST),
    };
  }
  const onLight = (min: number) => (c: string) => contrast(c, SURFACE_LIGHT) >= min;
  const onDark = (min: number) => (c: string) => contrast(c, SURFACE_DARK) >= min;
  return {
    ok: true,
    theme: {
      primary,
      primaryFg,
      primaryOnSurface: adjustLightness(primary, onLight(MIN_TEXT_CONTRAST))!,
      primaryOnSurfaceDark: adjustLightness(primary, onDark(MIN_TEXT_CONTRAST))!,
      focusRing: adjustLightness(primary, onLight(MIN_UI_CONTRAST))!,
      focusRingDark: adjustLightness(primary, onDark(MIN_UI_CONTRAST))!,
      accent,
      accentFg,
    },
  };
}

/** CSS custom properties for a derived theme (values are validated hex only). */
export function themeCss(theme: DerivedTheme): string {
  const vars = (entries: Array<[string, string]>) =>
    entries
      .filter(([, v]) => HEX_COLOR.test(v))
      .map(([k, v]) => `${k}:${v};`)
      .join("");
  const light = vars([
    ["--primary", theme.primary],
    ["--primary-foreground", theme.primaryFg],
    ["--ring", theme.focusRing],
    ["--brand-link", theme.primaryOnSurface],
    ["--brand-accent", theme.accent],
    ["--brand-accent-foreground", theme.accentFg],
  ]);
  const dark = vars([
    ["--primary", theme.primary],
    ["--primary-foreground", theme.primaryFg],
    ["--ring", theme.focusRingDark],
    ["--brand-link", theme.primaryOnSurfaceDark],
  ]);
  return `:root{${light}}.dark{${dark}}`;
}
