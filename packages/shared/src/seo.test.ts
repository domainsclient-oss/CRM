import { describe, expect, it } from "vitest";
import { DOCS, FAQ } from "./content/docs";
import { PAGES } from "./content/marketing";
import { faqPage, organization, robotsTxt, serializeJsonLd } from "./seo";

describe("structured data (TC-SEO-002)", () => {
  it("refuses non-marketing hosts", () => {
    for (const host of ["workspace", "console", "partners"] as const) {
      expect(() => serializeJsonLd(host, organization("CRM", "https://www.example.com"))).toThrow();
    }
  });

  it("escapes characters that could close the script element", () => {
    const out = serializeJsonLd("marketing", { name: "</script><script>alert(1)</script>&" });
    expect(out).not.toContain("</script>");
    expect(out).not.toContain("&");
    expect(JSON.parse(out)).toEqual({ name: "</script><script>alert(1)</script>&" });
  });

  it("FAQ markup matches the visible questions", () => {
    const data = faqPage(FAQ) as { mainEntity: Array<{ name: string }> };
    expect(data.mainEntity.map((q) => q.name)).toEqual(FAQ.map(([q]) => q));
  });
});

describe("robots policy (TC-SEO-001)", () => {
  it("lets crawlers see noindex on workspace hosts and blocks consoles", () => {
    expect(robotsTxt("workspace")).toContain("Allow: /");
    expect(robotsTxt("console")).toContain("Disallow: /");
    expect(robotsTxt("partners")).toContain("Disallow: /");
  });
});

describe("content rules (07 §2, §4)", () => {
  it("titles ≤ 60 and descriptions ≤ 155 characters", () => {
    for (const p of Object.values(PAGES)) {
      expect(p.title.length, p.path).toBeLessThanOrEqual(60);
      expect(p.description.length, p.path).toBeLessThanOrEqual(155);
    }
  });

  it("docs are question-led with short direct answers", () => {
    for (const d of DOCS) {
      expect(d.title.endsWith("?"), d.slug).toBe(true);
      expect(d.summary.split(/\s+/).length, d.slug).toBeLessThanOrEqual(50);
      for (const r of d.related)
        expect(
          DOCS.some((x) => x.slug === r),
          `${d.slug} → ${r}`,
        ).toBe(true);
    }
  });
});
