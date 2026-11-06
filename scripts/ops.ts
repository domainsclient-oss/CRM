// Production operations as code (T-11-01 hardening, T-11-02 monitoring). Prints the exact gcloud
// commands for an instance + environment; `--apply` runs them (human approval H6, operator
// credentials). gcloud flags were written against current docs but MUST be checked with
// `--dry-run` output on the first real project (T-01-09) — commands are printed for review first.
//
//   pnpm ops harden     --instance shared-us --env production --billing-account XXXX --budget 500 [--apply]
//   pnpm ops monitoring --instance shared-us --env production --notify <channel-id> [--apply]
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  isPlaceholder,
  loadInstances,
  parseDeployEnv,
  type DeployEnv,
  type Instance,
} from "./instances";

export type Command = { args: string[]; note: string; file?: { name: string; content: string } };

const SECRET_APIS = [
  "firestore.googleapis.com",
  "secretmanager.googleapis.com",
  "cloudfunctions.googleapis.com",
  "cloudscheduler.googleapis.com",
  "monitoring.googleapis.com",
  "logging.googleapis.com",
  "iamcredentials.googleapis.com",
];

/** T-11-01: PITR, backups, delete protection, key-creation policy, APIs, budgets. */
export function hardeningCommands(
  instance: Instance,
  env: DeployEnv,
  opts: { billingAccount?: string; budget?: number },
): Command[] {
  const project = instance.environments[env].firebaseProjectId;
  const p = ["--project", project];
  const db = ["--database=(default)"];
  const cmds: Command[] = [
    { args: ["services", "enable", ...SECRET_APIS, ...p], note: "Required APIs" },
    {
      args: ["firestore", "databases", "update", ...db, "--enable-pitr", ...p],
      note: "PITR, 7-day window (10 §9)",
    },
    {
      args: ["firestore", "databases", "update", ...db, "--delete-protection", ...p],
      note: "Database delete protection",
    },
    {
      args: [
        "firestore",
        "backups",
        "schedules",
        "create",
        ...db,
        "--recurrence=daily",
        "--retention=7d",
        ...p,
      ],
      note: "Daily backups, 7 days",
    },
    {
      args: [
        "firestore",
        "backups",
        "schedules",
        "create",
        ...db,
        "--recurrence=weekly",
        "--day-of-week=SUN",
        "--retention=14w",
        ...p,
      ],
      note: "Weekly backups, 14 weeks",
    },
    {
      args: [
        "resource-manager",
        "org-policies",
        "enable-enforce",
        "iam.disableServiceAccountKeyCreation",
        ...p,
      ],
      note: "No service-account keys (04 §6, S5)",
    },
  ];
  if (opts.billingAccount && opts.budget) {
    cmds.push({
      args: [
        "billing",
        "budgets",
        "create",
        `--billing-account=${opts.billingAccount}`,
        `--display-name=crm-${instance.name}-${env}`,
        `--budget-amount=${opts.budget}USD`,
        "--threshold-rule=percent=0.5",
        "--threshold-rule=percent=0.8",
        "--threshold-rule=percent=1.0",
        "--threshold-rule=percent=1.0,basis=forecasted-spend",
        `--filter-projects=projects/${project}`,
      ],
      note: "Budget alerts 50/80/100 % + forecast (T-08-06)",
    });
  }
  return cmds;
}

/** Log-based metrics and alert conditions (T-09-08 table, 10 §10). Messages must exist in code. */
export const LOG_ALERTS = [
  {
    metric: "crm_rate_limit_store_unavailable",
    message: "rate_limit.store_unavailable",
    threshold: 0,
    window: "300s",
    severity: "page",
  },
  {
    metric: "crm_tenant_mismatch",
    message: "tenant_mismatch",
    threshold: 0,
    window: "300s",
    severity: "security",
  },
  {
    metric: "crm_unhandled_error",
    message: "unhandled_error",
    threshold: 5,
    window: "300s",
    severity: "page",
  },
  {
    metric: "crm_authz_denied",
    message: "authz.denied",
    threshold: 100,
    window: "60s",
    severity: "security",
  },
  {
    metric: "crm_webhook_invalid_signature",
    message: "payment.webhook_invalid_signature",
    threshold: 10,
    window: "60s",
    severity: "security",
  },
  {
    metric: "crm_payment_event_failed",
    message: "payment.event_failed",
    threshold: 0,
    window: "300s",
    severity: "billing",
  },
  {
    metric: "crm_reconciliation_drift",
    message: "payment.reconciliation_drift",
    threshold: 0,
    window: "3600s",
    severity: "billing",
  },
  {
    metric: "crm_health_firestore",
    message: "health.firestore_unreachable",
    threshold: 1,
    window: "300s",
    severity: "page",
  },
  {
    metric: "crm_job_failed",
    message: "job_failed",
    threshold: 0,
    window: "300s",
    severity: "ops",
  },
  {
    metric: "crm_mail_delivery_failed",
    message: "mail.delivery_failed",
    threshold: 0,
    window: "300s",
    severity: "ops",
  },
  {
    metric: "crm_domain_check_failed",
    message: "domain_check_failed",
    threshold: 0,
    window: "3600s",
    severity: "ops",
  },
  {
    metric: "crm_tenant_purge_incomplete",
    message: "tenant_purge_incomplete",
    threshold: 0,
    window: "3600s",
    severity: "ops",
  },
] as const;

export function monitoringCommands(
  instance: Instance,
  env: DeployEnv,
  opts: { notify?: string },
): Command[] {
  const project = instance.environments[env].firebaseProjectId;
  const p = ["--project", project];
  const cmds: Command[] = [];
  for (const a of LOG_ALERTS) {
    cmds.push({
      args: [
        "logging",
        "metrics",
        "create",
        a.metric,
        `--description=CRM log metric: ${a.message}`,
        `--log-filter=jsonPayload.message="${a.message}"`,
        ...p,
      ],
      note: `Log metric (${a.severity})`,
    });
    const policy = {
      displayName: `CRM ${env}: ${a.message}`,
      combiner: "OR",
      conditions: [
        {
          displayName: `${a.message} > ${a.threshold} in ${a.window}`,
          conditionThreshold: {
            filter: `metric.type="logging.googleapis.com/user/${a.metric}" resource.type="global"`,
            comparison: "COMPARISON_GT",
            thresholdValue: a.threshold,
            duration: "0s",
            aggregations: [{ alignmentPeriod: a.window, perSeriesAligner: "ALIGN_SUM" }],
          },
        },
      ],
      notificationChannels: opts.notify ? [opts.notify] : [],
      userLabels: { severity: a.severity, instance: instance.name },
    };
    cmds.push({
      args: [
        "alpha",
        "monitoring",
        "policies",
        "create",
        `--policy-from-file=${a.metric}.json`,
        ...p,
      ],
      note: `Alert policy (${a.severity})`,
      file: { name: `${a.metric}.json`, content: JSON.stringify(policy, null, 2) },
    });
  }
  const d = instance.environments[env].domains;
  for (const [name, host, path] of [
    ["www", d.marketing, "/"],
    ["health", d.marketing, "/api/health"],
    ["console", d.console, "/login"],
    ["partners", d.partners, "/login"],
  ] as const) {
    cmds.push({
      args: [
        "monitoring",
        "uptime",
        "create",
        `crm-${instance.name}-${env}-${name}`,
        "--resource-type=uptime-url",
        `--resource-labels=host=${host},project_id=${project}`,
        `--path=${path}`,
        "--protocol=https",
        "--period=1",
        ...p,
      ],
      note: "Uptime check (2 consecutive failures → page, 10 §10)",
    });
  }
  return cmds;
}

function run(cmds: Command[], apply: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "crm-ops-"));
  for (const c of cmds) {
    const args = c.args.map((a) =>
      c.file && a.endsWith(c.file.name) ? a.replace(c.file.name, join(dir, c.file.name)) : a,
    );
    if (c.file) writeFileSync(join(dir, c.file.name), c.file.content);
    console.log(
      `# ${c.note}\ngcloud ${args.map((a) => (/\s|"/.test(a) ? `'${a}'` : a)).join(" ")}\n`,
    );
    if (!apply) continue;
    const r = spawnSync("gcloud", args, { stdio: "inherit", shell: process.platform === "win32" });
    if (r.status !== 0)
      console.error(
        `(failed: ${c.note} — continuing; fix and re-run, commands are idempotent or report "already exists")`,
      );
  }
  if (!apply)
    console.log(`# Dry run. Policy files written to ${dir}. Re-run with --apply after review.`);
}

if (process.argv[1]?.endsWith("ops.ts")) {
  const [mode] = process.argv.slice(2);
  const { values } = parseArgs({
    args: process.argv.slice(3),
    options: {
      instance: { type: "string" },
      env: { type: "string" },
      "billing-account": { type: "string" },
      budget: { type: "string" },
      notify: { type: "string" },
      apply: { type: "boolean", default: false },
    },
  });
  const instance = loadInstances().find((i) => i.name === values.instance);
  if (!instance) throw new Error(`Unknown --instance ${values.instance}`);
  const env = parseDeployEnv(values.env);
  if (isPlaceholder(instance.environments[env].firebaseProjectId)) {
    throw new Error(
      `instances/${instance.name}.json still has a placeholder project for ${env} (T-01-09)`,
    );
  }
  if (mode === "harden") {
    run(
      hardeningCommands(instance, env, {
        ...(values["billing-account"] ? { billingAccount: values["billing-account"] } : {}),
        ...(values.budget ? { budget: Number(values.budget) } : {}),
      }),
      values.apply,
    );
  } else if (mode === "monitoring") {
    run(
      monitoringCommands(instance, env, values.notify ? { notify: values.notify } : {}),
      values.apply,
    );
  } else {
    throw new Error("Usage: pnpm ops <harden|monitoring> --instance <name> --env <env> [--apply]");
  }
}
