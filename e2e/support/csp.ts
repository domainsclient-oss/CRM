import { expect, type Page, type TestType } from "@playwright/test";

// Fail any test whose page logs a Content Security Policy violation (TC-SEC-006).
export function failOnCspViolations(test: TestType<{ page: Page }, object>) {
  const violations: string[] = [];
  test.beforeEach(({ page }) => {
    violations.length = 0;
    page.on("console", (msg) => {
      if (/Content Security Policy|Content-Security-Policy/i.test(msg.text()))
        violations.push(msg.text());
    });
  });
  test.afterEach(() => {
    expect(violations, "CSP violations").toEqual([]);
  });
}

/** Strict nonce policy, and every script in the document carries the nonce. */
export async function expectNoncedPage(page: Page, csp: string | undefined) {
  expect(csp).toMatch(/script-src 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(csp).not.toContain("unsafe-inline' 'strict");
  const nonce = /'nonce-([^']+)'/.exec(csp ?? "")?.[1];
  const scriptNonces = await page.evaluate(() => [...document.scripts].map((s) => s.nonce));
  expect(scriptNonces.length).toBeGreaterThan(0);
  for (const n of scriptNonces) expect(n).toBe(nonce);
}
