"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@crm/ui/components/button";
import { Input } from "@crm/ui/components/input";
import { Label } from "@crm/ui/components/label";
import { NativeSelect } from "@crm/ui/components/native-select";
import { toast } from "@crm/ui/lib/toast";
import type { ActionResult } from "@crm/shared/errors";
import { t, type MessageKey } from "@crm/shared/i18n";
import { formatMoney } from "@crm/shared/records/money";
import { ActionError } from "./action-feedback";

type Action = (input: unknown) => Promise<ActionResult<unknown>>;
const PAID_PLANS = ["starter", "growth", "enterprise"] as const;

function useRun() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ActionResult<unknown> | null>(null);
  async function run(fn: () => Promise<ActionResult<unknown>>, success: string) {
    setPending(true);
    const r = await fn();
    setPending(false);
    setResult(r);
    if (r.ok) {
      toast.success(success);
      router.refresh();
    }
    return r.ok;
  }
  const fieldErrors = result && !result.ok ? (result.error.fieldErrors ?? {}) : {};
  return { pending, result, run, fieldErrors };
}

/** FR-BILL-001 AC2: write-only credentials; the stored values are never sent back. */
export function GatewayForm({
  action,
  webhookUrlBase,
}: {
  action: Action;
  webhookUrlBase: string;
}) {
  const s = useRun();
  const [provider, setProvider] = useState("razorpay");
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const d = new FormData(form);
    const ok = await s.run(
      () =>
        action({
          provider: d.get("provider"),
          env: d.get("env"),
          keyId: d.get("keyId"),
          keySecret: d.get("keySecret") ?? "",
          webhookSecret: d.get("webhookSecret"),
        }),
      t("console.billing.saved"),
    );
    if (ok) form.reset();
  }
  const field = (name: "keyId" | "keySecret" | "webhookSecret", label: MessageKey) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`gw-${name}`}>{t(label)}</Label>
      <Input
        id={`gw-${name}`}
        name={name}
        type="password"
        autoComplete="off"
        aria-describedby="gw-hint"
      />
      {s.fieldErrors[name] ? (
        <p className="text-sm text-destructive">{s.fieldErrors[name]!.join(" ")}</p>
      ) : null}
    </div>
  );
  return (
    <form onSubmit={onSubmit} className="flex max-w-xl flex-col gap-3" noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gw-provider">{t("console.billing.provider")}</Label>
          <NativeSelect
            id="gw-provider"
            name="provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          >
            <option value="razorpay">Razorpay</option>
            <option value="stripe">Stripe</option>
            <option value="paypal">PayPal</option>
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gw-env">{t("console.billing.env")}</Label>
          <NativeSelect id="gw-env" name="env" defaultValue="test">
            <option value="test">{t("console.billing.env.test")}</option>
            <option value="live">{t("console.billing.env.live")}</option>
          </NativeSelect>
        </div>
      </div>
      {field("keyId", "console.billing.keyId")}
      {field("keySecret", "console.billing.keySecret")}
      {field("webhookSecret", "console.billing.webhookSecret")}
      <p id="gw-hint" className="text-xs text-muted-foreground">
        {t("console.billing.secretsHint")}
      </p>
      <p className="text-xs break-all text-muted-foreground">
        {t("console.billing.webhookUrl", { url: `${webhookUrlBase}/${provider}/…` })}
      </p>
      <ActionError result={s.result} />
      <div>
        <Button type="submit" disabled={s.pending}>
          {t("console.billing.save")}
        </Button>
      </div>
    </form>
  );
}

export function PlanPrices({
  prices,
  setAction,
  removeAction,
}: {
  prices: Array<{
    planId: string;
    gatewayPlanId: string;
    amount: number;
    currency: string;
    interval: string;
  }>;
  setAction: Action;
  removeAction: Action;
}) {
  const s = useRun();
  const plan = (id: string) => t(`usage.plan.${id}` as MessageKey);
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const d = new FormData(form);
    if (
      await s.run(
        () => setAction({ planId: d.get("planId"), gatewayPlanId: d.get("gatewayPlanId") }),
        t("console.billing.priceSet"),
      )
    )
      form.reset();
  }
  return (
    <div className="flex flex-col gap-3">
      {prices.length > 0 ? (
        <ul className="flex flex-col divide-y rounded-xl border">
          {prices.map((p) => (
            <li
              key={p.planId}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
            >
              <span>
                <span className="font-medium">{plan(p.planId)}</span> ·{" "}
                {formatMoney(p.amount, p.currency, "en")} /{" "}
                {t(`billing.interval.${p.interval}` as MessageKey)} ·{" "}
                <span className="font-mono text-xs">{p.gatewayPlanId}</span>
              </span>
              <Button
                size="sm"
                variant="outline"
                aria-label={t("console.billing.removePrice", { plan: plan(p.planId) })}
                onClick={() =>
                  s.run(() => removeAction({ planId: p.planId }), t("console.billing.priceRemoved"))
                }
              >
                ×
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-end" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="price-plan">{t("console.billing.planId")}</Label>
          <NativeSelect id="price-plan" name="planId" defaultValue="starter">
            {PAID_PLANS.map((p) => (
              <option key={p} value={p}>
                {plan(p)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="price-gateway">{t("console.billing.gatewayPlanId")}</Label>
          <Input id="price-gateway" name="gatewayPlanId" autoComplete="off" />
        </div>
        <Button type="submit" disabled={s.pending}>
          {t("console.billing.addPrice")}
        </Button>
      </form>
      {s.fieldErrors.gatewayPlanId ? (
        <p role="alert" className="text-sm text-destructive">
          {s.fieldErrors.gatewayPlanId.join(" ")}
        </p>
      ) : (
        <ActionError result={s.result} />
      )}
    </div>
  );
}

/** FR-BILL-005: plan + paid-until for clients billed outside a gateway. */
export function ManualBillingForm({
  tenantId,
  planId,
  paidUntil,
  action,
}: {
  tenantId: string;
  planId: string;
  paidUntil: string | null;
  action: Action;
}) {
  const s = useRun();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    await s.run(
      () => action({ tenantId, planId: d.get("planId"), paidUntil: d.get("paidUntil") }),
      t("console.billing.manualSaved"),
    );
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-end" noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="manual-plan">{t("console.billing.planId")}</Label>
        <NativeSelect id="manual-plan" name="planId" defaultValue={planId}>
          {(["trial", ...PAID_PLANS] as const).map((p) => (
            <option key={p} value={p}>
              {t(`usage.plan.${p}` as MessageKey)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="manual-until">{t("console.billing.paidUntil")}</Label>
        <Input
          id="manual-until"
          name="paidUntil"
          type="date"
          defaultValue={paidUntil ?? ""}
          required
        />
      </div>
      <Button type="submit" disabled={s.pending}>
        {t("record.save")}
      </Button>
      <ActionError result={s.result} />
    </form>
  );
}
