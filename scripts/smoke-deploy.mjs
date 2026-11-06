// Post-deploy smoke (T-11-04 step "smoke", release workflow, 10 §5): read-only HTTP checks of a
// deployed environment. Never writes data. Exit 1 on any failure.
//
//   node scripts/smoke-deploy.mjs --marketing www.example.com --console console.example.com \
//     --partners partners.example.com --app-base app.example.com [--scheme http]
import { parseArgs } from "node:util";

export async function smoke(
  { marketing, console: consoleHost, partners, appBase, scheme = "https" },
  fetcher = fetch,
) {
  const results = [];
  const url = (host, path) => `${scheme}://${host}${path}`;
  async function check(name, target, init, assert) {
    try {
      const res = await fetcher(target, { redirect: "manual", ...init });
      const body = await res.text();
      const problem = assert(res, body);
      results.push({ name, ok: !problem, problem: problem || null, status: res.status });
    } catch (error) {
      results.push({ name, ok: false, problem: `request failed: ${error.message}`, status: null });
    }
  }
  const header = (res, h) => res.headers.get(h) ?? "";
  const secure = scheme === "https";

  await check("marketing home", url(marketing, "/"), {}, (res, body) => {
    if (res.status !== 200) return `status ${res.status}`;
    if (!header(res, "content-security-policy").includes("frame-ancestors 'none'"))
      return "CSP missing";
    if (header(res, "x-content-type-options") !== "nosniff") return "nosniff missing";
    if (secure && !header(res, "strict-transport-security").includes("max-age"))
      return "HSTS missing";
    if (!body.includes('rel="canonical"')) return "canonical missing";
    return "";
  });
  await check("health", url(marketing, "/api/health"), {}, (res, body) =>
    res.status === 200 &&
    JSON.parse(body).status === "ok" &&
    header(res, "cache-control").includes("no-store")
      ? ""
      : `status ${res.status}`,
  );
  await check("marketing robots + sitemap link", url(marketing, "/robots.txt"), {}, (res, body) =>
    res.status === 200 && body.includes("Sitemap:") && body.includes("Disallow: /api/")
      ? ""
      : "robots policy",
  );
  await check("console sign-in", url(consoleHost, "/login"), {}, (res) =>
    res.status === 200 && header(res, "x-robots-tag").includes("noindex")
      ? ""
      : `status ${res.status} / robots`,
  );
  await check("console robots", url(consoleHost, "/robots.txt"), {}, (res, body) =>
    body.includes("Disallow: /") ? "" : "console must disallow crawling",
  );
  await check("partners sign-in", url(partners, "/login"), {}, (res) =>
    res.status === 200 ? "" : `status ${res.status}`,
  );
  const unknown = `smoke-${Math.random().toString(36).slice(2, 10)}.${appBase}`;
  await check("unknown workspace is a real 404", url(unknown, "/"), {}, (res) =>
    res.status === 404 ? "" : `status ${res.status}`,
  );
  await check("workspace hosts have no sitemap", url(unknown, "/sitemap.xml"), {}, (res) =>
    res.status === 404 ? "" : `status ${res.status}`,
  );
  await check(
    "unsigned webhook changes nothing",
    url(marketing, "/api/webhooks/razorpay/agy_smoke_none"),
    { method: "POST", body: "{}", headers: { "content-type": "application/json" } },
    (res) => (res.status === 404 || res.status === 400 ? "" : `status ${res.status}`),
  );
  await check(
    "session endpoint refuses cross-origin",
    url(consoleHost, "/api/auth/session"),
    {
      method: "POST",
      body: "{}",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example",
        "x-crm-request": "1",
      },
    },
    (res) => (res.status === 403 ? "" : `status ${res.status}`),
  );
  return results;
}

if (process.argv[1]?.endsWith("smoke-deploy.mjs")) {
  const { values } = parseArgs({
    options: {
      marketing: { type: "string" },
      console: { type: "string" },
      partners: { type: "string" },
      "app-base": { type: "string" },
      scheme: { type: "string", default: "https" },
    },
  });
  if (!values.marketing || !values.console || !values.partners || !values["app-base"]) {
    console.error("Required: --marketing --console --partners --app-base");
    process.exit(2);
  }
  const results = await smoke({
    marketing: values.marketing,
    console: values.console,
    partners: values.partners,
    appBase: values["app-base"],
    scheme: values.scheme,
  });
  for (const r of results)
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.problem ? ` — ${r.problem}` : ""}`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}
