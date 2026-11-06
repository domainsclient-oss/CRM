// Client bundle scan (TC-SEC-008, NFR-SEC-007): fails if anything shipped to browsers contains
// a server-only environment variable name or key material. Run after `pnpm build`.
//
// Scans apps/*/.next/static (all browser JS/CSS) and the prerendered HTML/RSC payloads.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

// Server-only variable names come from the server env schema itself, so new ones are covered.
const schema = readFileSync(join(ROOT, "packages/core/src/server-env.ts"), "utf8");
const SERVER_VARS = [...schema.matchAll(/^\s{4}([A-Z][A-Z0-9_]{3,}):/gm)]
  .map((m) => m[1])
  // Present in public config too (the Firebase project ID is public by design).
  .filter((name) => name !== "FIREBASE_PROJECT_ID");

const KEY_MATERIAL = [
  ["private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["service-account JSON", /"private_key_id"\s*:/],
  ["Stripe secret key", /\b(sk|rk)_(live|test)_[A-Za-z0-9]{10,}/],
  ["Razorpay secret", /\brzp_(live|test)_[A-Za-z0-9]{10,}:[A-Za-z0-9]{10,}/],
  ["Upstash token", /\bAX[A-Za-z0-9]{30,}=/],
  ["Vercel token", /\bvercel_[A-Za-z0-9]{20,}/i],
  ["Google OAuth client secret", /\bGOCSPX-[A-Za-z0-9_-]{20,}/],
];

function* files(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(js|mjs|css|html|rsc|txt|json|map)$/.test(name)) yield path;
  }
}

const targets = ["apps/web", "apps/console"].flatMap((app) => [
  join(ROOT, app, ".next/static"),
  join(ROOT, app, ".next/server/app"), // prerendered HTML + RSC payloads sent to browsers
]);

let scanned = 0;
const findings = [];
for (const dir of targets) {
  for (const file of files(dir)) {
    // Server bundles (route handlers, server components) are not sent to browsers.
    if (dir.endsWith("server/app") && !/\.(html|rsc|body)$/.test(file)) continue;
    const text = readFileSync(file, "utf8");
    scanned++;
    for (const name of SERVER_VARS) {
      if (text.includes(name)) findings.push(`${file}: server env name ${name}`);
    }
    for (const [label, pattern] of KEY_MATERIAL) {
      if (pattern.test(text)) findings.push(`${file}: ${label}`);
    }
  }
}

if (scanned === 0) {
  console.error("No build output found. Run `pnpm build` first.");
  process.exit(1);
}
if (findings.length) {
  console.error(`Client bundle scan failed (${findings.length}):\n  ${findings.join("\n  ")}`);
  process.exit(1);
}
console.log(
  `Client bundle scan: ${scanned} files, ${SERVER_VARS.length} server variable names, no findings.`,
);
