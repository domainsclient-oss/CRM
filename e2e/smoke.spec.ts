import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("smoke", () => {
  test("home page renders with one h1 and no horizontal overflow", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
  });

  test("skip link is the first focusable element and targets main content", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName === "webkit", "Safari skips links on Tab unless the OS setting is on");
    await page.goto("/");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to main content" });
    await expect(skip).toBeFocused();
    await expect(skip).toHaveAttribute("href", "#main");
  });

  test("unknown routes return a neutral 404", async ({ page }) => {
    const response = await page.goto("/definitely-not-a-page");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  });

  test("marketing home is indexable; the 404 page is not (07 §1–2)", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /^index/);
    await page.goto("/definitely-not-a-page");
    const robots = await page
      .locator('meta[name="robots"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute("content")));
    expect(robots.length).toBeGreaterThan(0);
    expect(robots.every((c) => c?.includes("noindex"))).toBe(true);
  });

  test("UI catalog is hidden in production builds", async ({ page }) => {
    const response = await page.goto("/ui-catalog");
    expect(response?.status()).toBe(404);
  });

  test("health endpoint exposes status only and is never cached", async ({ request }) => {
    const response = await request.get("/api/health");
    // 503 is expected where Firestore isn't reachable (e.g. CI without credentials).
    expect([200, 503]).toContain(response.status());
    expect(response.headers()["cache-control"]).toContain("no-store");
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(["firestore", "status"]);
  });

  test("home and 404 pages have no WCAG A/AA violations", async ({ page }) => {
    for (const path of ["/", "/definitely-not-a-page"]) {
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(results.violations.map((v) => v.id)).toEqual([]);
    }
  });

  test("marketing pages send baseline security headers and a CSP (TC-SEC-006)", async ({
    page,
  }) => {
    const res = await page.goto("/");
    const h = res!.headers();
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["content-security-policy"]).toContain("object-src 'none'");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-powered-by"]).toBeUndefined();
  });
});
