import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LOG_ALERTS, hardeningCommands, monitoringCommands } from "./ops";
import type { Instance } from "./instances";

const instance: Instance = {
  name: "test-inst",
  region: { firestore: "us-east1", functions: "us-east1", vercel: "iad1" },
  defaultCurrency: "USD",
  environments: Object.fromEntries(
    (["dev", "staging", "production"] as const).map((e) => [
      e,
      {
        firebaseProjectId: `crm-${e}`,
        domains: {
          marketing: `www.${e}.example.com`,
          appBase: `app.${e}.example.com`,
          console: `console.${e}.example.com`,
          partners: `partners.${e}.example.com`,
        },
      },
    ]),
  ) as Instance["environments"],
  vercel: { webProjectId: "w", consoleProjectId: "c" },
};

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) continue;
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
      out.push(readFileSync(path, "utf8"));
  }
  return out;
}

describe("ops as code (T-11-01, T-11-02)", () => {
  it("targets only the chosen environment's project", () => {
    const cmds = [
      ...hardeningCommands(instance, "production", { billingAccount: "B-1", budget: 500 }),
      ...monitoringCommands(instance, "production", {}),
    ];
    for (const c of cmds) {
      if (c.args[0] === "billing") {
        expect(c.args).toContain("--filter-projects=projects/crm-production"); // billing-account scoped
        continue;
      }
      expect(c.args).toContain("--project");
      expect(c.args[c.args.indexOf("--project") + 1]).toBe("crm-production");
    }
  });

  it("covers PITR, both backup schedules, key-creation policy and budgets", () => {
    const text = hardeningCommands(instance, "production", { billingAccount: "B-1", budget: 500 })
      .map((c) => c.args.join(" "))
      .join("\n");
    expect(text).toContain("--enable-pitr");
    expect(text).toContain("--recurrence=daily --retention=7d");
    expect(text).toContain("--recurrence=weekly");
    expect(text).toContain("iam.disableServiceAccountKeyCreation");
    expect(text).toContain("--threshold-rule=percent=0.8");
  });

  it("alerts only on log messages the code actually emits", () => {
    const code = [
      ...sources(join(__dirname, "../packages/core/src")),
      ...sources(join(__dirname, "../apps/web/src")),
      ...sources(join(__dirname, "../apps/console/src")),
    ].join("\n");
    for (const a of LOG_ALERTS) expect(code, a.message).toContain(`"${a.message}"`);
  });

  it("writes valid alert-policy JSON and uptime checks for every public host", () => {
    const cmds = monitoringCommands(instance, "staging", {
      notify: "projects/p/notificationChannels/1",
    });
    const policies = cmds.filter((c) => c.file).map((c) => JSON.parse(c.file!.content));
    expect(policies).toHaveLength(LOG_ALERTS.length);
    expect(policies.every((p) => p.notificationChannels.length === 1)).toBe(true);
    const uptime = cmds.filter((c) => c.args.includes("uptime")).map((c) => c.args.join(" "));
    for (const host of ["www.staging", "console.staging", "partners.staging"]) {
      expect(uptime.some((u) => u.includes(`host=${host}.example.com`))).toBe(true);
    }
  });
});
