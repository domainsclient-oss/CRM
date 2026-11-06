import { describe, expect, it } from "vitest";
import {
  MIN_TEXT_CONTRAST,
  MIN_UI_CONTRAST,
  SURFACE_DARK,
  SURFACE_LIGHT,
  adjustLightness,
  contrast,
  deriveTheme,
  themeCss,
} from "./theme";

// TC-BRAND-002: extreme brand colours still produce compliant combinations.
describe("contrast", () => {
  it("matches WCAG reference values", () => {
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 1);
    expect(contrast("#FFFFFF", "#FFFFFF")).toBe(1);
    expect(contrast("#777777", "#FFFFFF")).toBeCloseTo(4.48, 1);
  });
});

describe("deriveTheme", () => {
  it.each([
    "#1F6FEB",
    "#FFFF00",
    "#00FF00",
    "#FF0000",
    "#000000",
    "#FFFFFF",
    "#7F7F7F",
    "#F59E0B",
    "#0EA5E9",
  ])("derives compliant colours for %s", (color) => {
    const result = deriveTheme(color, "#F59E0B");
    if (!result.ok) {
      // Mid-greys can fail both text colours: the suggestion must itself be compliant.
      expect(result.suggestion).toMatch(/^#[0-9A-F]{6}$/);
      const retry = deriveTheme(result.suggestion!, "#F59E0B");
      expect(retry.ok).toBe(true);
      return;
    }
    const t = result.theme;
    expect(contrast(t.primaryFg, t.primary)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(contrast(t.primaryOnSurface, SURFACE_LIGHT)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(contrast(t.primaryOnSurfaceDark, SURFACE_DARK)).toBeGreaterThanOrEqual(
      MIN_TEXT_CONTRAST,
    );
    expect(contrast(t.focusRing, SURFACE_LIGHT)).toBeGreaterThanOrEqual(MIN_UI_CONTRAST);
    expect(contrast(t.focusRingDark, SURFACE_DARK)).toBeGreaterThanOrEqual(MIN_UI_CONTRAST);
    expect(contrast(t.accentFg, t.accent)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });

  it("keeps compliant colours unchanged and preserves hue when adjusting", () => {
    expect(adjustLightness("#1F6FEB", () => true)).toBe("#1F6FEB");
    const darker = adjustLightness("#FFFF00", (c) => contrast(c, SURFACE_LIGHT) >= 4.5)!;
    expect(contrast(darker, SURFACE_LIGHT)).toBeGreaterThanOrEqual(4.5);
    // Still yellow-ish (red and green dominate blue).
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(darker.slice(i, i + 2), 16));
    expect(r! > b! && g! > b!).toBe(true);
  });

  it("emits only validated hex values as CSS variables", () => {
    const result = deriveTheme("#1F6FEB", "#F59E0B");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const css = themeCss({ ...result.theme, accent: "red;}body{display:none" });
    expect(css).toContain("--primary:#1F6FEB;");
    expect(css).not.toContain("display:none");
    expect(css).not.toContain("--brand-accent:");
  });
});
