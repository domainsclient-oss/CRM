import { gzipSync } from "node:zlib";
import type { APIRequestContext } from "@playwright/test";

// Initial JavaScript for a page (TC-PERF-001): the scripts referenced by the server HTML, gzipped.
// Excluded: `nomodule` polyfills (modern browsers never fetch them) and route prefetches
// triggered later by visible links.
export async function initialJsBytes(request: APIRequestContext, url: string): Promise<number> {
  const html = await (await request.get(url)).text();
  const scripts = [...html.matchAll(/<script\b([^>]*)>/g)]
    .map((m) => m[1] ?? "")
    .filter((attrs) => !/\bnoModule\b|\bnomodule\b/.test(attrs))
    .map((attrs) => /\bsrc="([^"]+)"/.exec(attrs)?.[1])
    .filter((src): src is string => Boolean(src));
  if (scripts.length === 0) throw new Error(`no scripts found at ${url}`);
  let total = 0;
  for (const src of new Set(scripts)) {
    total += gzipSync(await (await request.get(new URL(src, url).toString())).body()).length;
  }
  return total;
}

export const PUBLIC_JS_BUDGET = 150 * 1024;
export const APP_JS_BUDGET = 250 * 1024;
