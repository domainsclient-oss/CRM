import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { PUBLIC_JS_BUDGET, initialJsBytes } from "./support/budget";

// SEO / AEO and public performance budgets (requirements/07, TC-SEO-001/002, TC-PERF-001).
// Marketing host = baseURL. Canonical URLs use the origin configured at build time
// (APP_MARKETING_HOST), which robots.txt also advertises, so tests read it from there.
// Workspace-host checks use a *.localhost name, which browsers resolve to loopback;
// /robots.txt there is answered by the proxy before any tenant lookup.

const INDEXABLE = [
  "/",
  "/features",
  "/agencies",
  "/plans",
  "/security",
  "/about",
  "/contact",
  "/docs",
  "/docs/import-contacts-csv",
  "/faq",
  "/glossary",
  "/legal/privacy",
  "/legal/terms",
  "/legal/cookies",
];

async function siteOrigin(request: APIRequestContext): Promise<string> {
  const robots = await (await request.get("/robots.txt")).text();
  const origin = /^Sitemap: (https?:\/\/[^/\s]+)\/sitemap\.xml$/m.exec(robots)?.[1];
  expect(origin, "robots.txt advertises an absolute sitemap URL").toBeTruthy();
  return origin!;
}

test.describe("marketing SEO (TC-SEO-001)", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Markup checks are engine-neutral");

  for (const path of INDEXABLE) {
    test(`${path} has unique metadata, a canonical and one h1`, async ({ page, request }) => {
      const origin = await siteOrigin(request);
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      const title = await page.title();
      expect(title.length).toBeGreaterThan(0);
      expect(title.length).toBeLessThanOrEqual(60);
      const description = await page.locator('meta[name="description"]').getAttribute("content");
      expect(description?.length ?? 0).toBeGreaterThan(0);
      expect(description!.length).toBeLessThanOrEqual(155);
      const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
      expect(canonical?.replace(/\/$/, "")).toBe(`${origin}${path === "/" ? "" : path}`);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /^index/);
      await expect(page.locator('meta[property="og:image"]').first()).toHaveAttribute(
        "content",
        /og-image/,
      );
    });
  }

  test("titles are unique across pages", async ({ page }) => {
    const titles = new Set<string>();
    for (const path of INDEXABLE) {
      await page.goto(path);
      titles.add(await page.title());
    }
    expect(titles.size).toBe(INDEXABLE.length);
  });

  test("find-workspace is reachable but not indexed", async ({ page }) => {
    expect((await page.goto("/find-workspace"))?.status()).toBe(200);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });
});

async function jsonLd(page: Page): Promise<Array<Record<string, unknown>>> {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  return blocks.flatMap((b) => {
    const parsed = JSON.parse(b) as unknown;
    return (Array.isArray(parsed) ? parsed : [parsed]) as Array<Record<string, unknown>>;
  });
}

test.describe("structured data (TC-SEO-002)", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Markup checks are engine-neutral");

  test("home declares Organization, WebSite and SoftwareApplication", async ({ page }) => {
    await page.goto("/");
    const types = (await jsonLd(page)).map((d) => d["@type"]);
    expect(types).toEqual(
      expect.arrayContaining(["Organization", "WebSite", "SoftwareApplication"]),
    );
  });

  test("FAQPage markup matches the visible questions verbatim", async ({ page }) => {
    await page.goto("/faq");
    const faq = (await jsonLd(page)).find((d) => d["@type"] === "FAQPage");
    const questions = (faq?.mainEntity as Array<{ name: string }>).map((q) => q.name);
    const visible = await page.getByRole("heading", { level: 2 }).allTextContents();
    expect(questions).toEqual(visible);
  });

  test("docs articles carry TechArticle and BreadcrumbList", async ({ page }) => {
    await page.goto("/docs/import-contacts-csv");
    const types = (await jsonLd(page)).map((d) => d["@type"]);
    expect(types).toEqual(expect.arrayContaining(["TechArticle", "BreadcrumbList"]));
  });
});

test.describe("crawl policy per host (07 §1)", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "HTTP-level checks");

  test("marketing robots.txt, sitemap and llms.txt", async ({ request }) => {
    const origin = await siteOrigin(request);
    const robots = await (await request.get("/robots.txt")).text();
    expect(robots).toContain("Disallow: /find-workspace");
    expect(robots).toContain("Disallow: /api/");

    const sitemap = await (await request.get("/sitemap.xml")).text();
    expect(sitemap).toContain(`<loc>${origin}/docs/import-contacts-csv</loc>`);
    expect(sitemap).toContain("<lastmod>");
    expect(sitemap).not.toContain("find-workspace");

    const llms = await request.get("/llms.txt");
    expect(llms.status()).toBe(200);
    expect(llms.headers()["content-type"]).toContain("text/plain");
    expect(await llms.text()).toContain("## Help centre");
  });

  test("the Open Graph image renders", async ({ request }) => {
    const res = await request.get("/og-image");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/png");
  });

  test("workspace hosts allow crawl but are noindex, with no sitemap or llms.txt", async ({
    page,
    baseURL,
  }) => {
    const ws = baseURL!.replace("://localhost", "://seo-check.localhost");
    const robots = await page.goto(`${ws}/robots.txt`);
    expect(robots?.status()).toBe(200);
    expect(await robots?.text()).toBe("User-agent: *\nAllow: /\nDisallow: /api/\n");
    expect(robots?.headers()["x-robots-tag"]).toContain("noindex");
    expect((await page.goto(`${ws}/sitemap.xml`))?.status()).toBe(404);
    expect((await page.goto(`${ws}/llms.txt`))?.status()).toBe(404);
  });
});

test.describe("public performance budget (TC-PERF-001)", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Measured once, on Chromium");

  for (const path of ["/", "/docs", "/docs/import-contacts-csv", "/contact"]) {
    test(`${path} ships ≤ 150 KB of gzipped JavaScript on first load`, async ({
      request,
      baseURL,
    }) => {
      expect(await initialJsBytes(request, `${baseURL}${path}`)).toBeLessThanOrEqual(
        PUBLIC_JS_BUDGET,
      );
    });
  }
});

test.describe("marketing accessibility (TC-A11Y-001)", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Axe runs once, on Chromium");

  test("public pages have no WCAG 2.2 A/AA violations", async ({ page }) => {
    for (const path of [...INDEXABLE, "/find-workspace"]) {
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(results.violations.map((v) => `${path}: ${v.id}`)).toEqual([]);
    }
  });
});
