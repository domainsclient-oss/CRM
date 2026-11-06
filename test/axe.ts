import axe from "axe-core";
import { expect } from "vitest";

/** Fail the test on any WCAG 2.2 A/AA violation in the rendered container (NFR-A11Y-001). */
export async function expectNoA11yViolations(container: Element): Promise<void> {
  const results = await axe.run(container, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    // Color contrast needs real layout/CSS; covered by Playwright axe scans (TC-A11Y-001).
    rules: { "color-contrast": { enabled: false } },
  });
  const summary = results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`);
  expect(summary).toEqual([]);
}
