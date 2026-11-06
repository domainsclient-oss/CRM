"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { BrandingEditor, type BrandingValues } from "@crm/ui/components/branding-editor";
import { Button } from "@crm/ui/components/button";
import { Input } from "@crm/ui/components/input";
import { Label } from "@crm/ui/components/label";
import { NativeSelect } from "@crm/ui/components/native-select";
import { toast } from "@crm/ui/lib/toast";
import { actionErrorMessage } from "@crm/shared/auth-messages";
import type { BrandAssetKind } from "@crm/shared/branding/schemas";
import type { ActionResult } from "@crm/shared/errors";
import { t, type MessageKey } from "@crm/shared/i18n";

type Action = (input: unknown) => Promise<ActionResult<unknown>>;

/** Branding editor bound to console actions; `tenantId` targets a client workspace. */
export function ConsoleBranding({
  tenantId,
  own,
  inherited,
  assets,
  actions,
}: {
  tenantId?: string;
  own: BrandingValues;
  inherited: { appName: string; primaryColor: string; accentColor: string };
  assets: Record<BrandAssetKind, string | null>;
  actions: { save: Action; upload: Action; remove: Action };
}) {
  const router = useRouter();
  const target = tenantId ? { tenantId } : {};
  return (
    <BrandingEditor
      own={own}
      inherited={inherited}
      assets={assets}
      onSave={(values) => actions.save({ ...target, ...values })}
      onUpload={(kind, file) => actions.upload({ ...target, kind, file })}
      onRemove={(kind) => actions.remove({ ...target, kind })}
      onChanged={() => router.refresh()}
    />
  );
}

/** Platform: plan, limit overrides, feature flags (FR-PLAN-001/004). */
export function PlanEditor({
  tenantId,
  planId,
  plans,
  overrides,
  flags,
  action,
}: {
  tenantId: string;
  planId: string;
  plans: string[];
  overrides: { seats: number | null; records: number | null };
  flags: Record<string, boolean>;
  action: Action;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    setPending(true);
    const result = await action({
      tenantId,
      planId: d.get("planId"),
      seats: d.get("seats"),
      records: d.get("records"),
      flags: Object.fromEntries(Object.keys(flags).map((f) => [f, d.get(`flag-${f}`) === "on"])),
    });
    setPending(false);
    if (result.ok) {
      setError(null);
      toast.success(t("console.plan.saved"));
      router.refresh();
    } else setError(actionErrorMessage(result.error));
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-xl flex-col gap-4" noValidate>
      <h2 className="text-lg font-medium">{t("console.plan.title")}</h2>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="plan-id">{t("console.plan.plan")}</Label>
        <NativeSelect id="plan-id" name="planId" defaultValue={planId}>
          {plans.map((p) => (
            <option key={p} value={p}>
              {t(`usage.plan.${p}` as MessageKey)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {(["seats", "records"] as const).map((k) => (
          <div key={k} className="flex flex-col gap-1.5">
            <Label htmlFor={`plan-${k}`}>{t(`console.plan.${k}` as MessageKey)}</Label>
            <Input
              id={`plan-${k}`}
              name={k}
              type="number"
              min={k === "seats" ? 1 : 0}
              defaultValue={overrides[k] ?? ""}
              aria-describedby="plan-override-hint"
            />
          </div>
        ))}
      </div>
      <p id="plan-override-hint" className="text-xs text-muted-foreground">
        {t("console.plan.overrideHint")}
      </p>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{t("console.plan.flags")}</legend>
        {Object.entries(flags).map(([flag, on]) => (
          <div key={flag} className="flex items-center gap-2">
            <input
              id={`flag-${flag}`}
              name={`flag-${flag}`}
              type="checkbox"
              defaultChecked={on}
              className="size-4"
            />
            <Label htmlFor={`flag-${flag}`}>{t(`console.plan.flag.${flag}` as MessageKey)}</Label>
          </div>
        ))}
      </fieldset>
      <div>
        <Button type="submit" disabled={pending}>
          {t("record.save")}
        </Button>
      </div>
    </form>
  );
}

/** Agency staff list + invite (FR-AGY-002). */
export function StaffManager({
  staff,
  pending: pendingInvites,
  canInvite,
  action,
}: {
  staff: Array<{ uid: string; email: string; displayName: string; role: string }>;
  pending: Array<{ id: string; email: string }>;
  canInvite: boolean;
  action: Action;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    const result = await action({ email: new FormData(form).get("email") });
    setBusy(false);
    if (result.ok) {
      setError(null);
      form.reset();
      toast.success(
        t("console.staff.invited", { email: (result.data as { email: string }).email }),
      );
      router.refresh();
    } else setError(result.error.fieldErrors?.email?.join(" ") ?? actionErrorMessage(result.error));
  }

  return (
    <section aria-labelledby="staff-heading" className="flex flex-col gap-3">
      <h2 id="staff-heading" className="text-lg font-medium">
        {t("console.staff")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("console.staff.body")}</p>
      <ul className="flex flex-col divide-y rounded-xl border">
        {staff.map((s) => (
          <li key={s.uid} className="flex flex-wrap justify-between gap-2 px-3 py-2 text-sm">
            <span className="font-medium">{s.displayName || s.email}</span>
            <span className="text-muted-foreground">
              {s.email} · {t(`console.staff.role.${s.role}` as MessageKey)}
            </span>
          </li>
        ))}
        {pendingInvites.map((p) => (
          <li key={p.id} className="px-3 py-2 text-sm text-muted-foreground">
            {t("console.staff.pending", { email: p.email })}
          </li>
        ))}
      </ul>
      {canInvite ? (
        <form
          onSubmit={onSubmit}
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
          noValidate
        >
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="staff-email">{t("console.staff.email")}</Label>
            <Input id="staff-email" name="email" type="email" autoComplete="off" required />
          </div>
          <Button type="submit" disabled={busy}>
            {t("console.staff.invite")}
          </Button>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}

/** Agency base domain (FR-TEN-009). */
export function BaseDomainForm({ value, action }: { value: string | null; action: Action }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await action({ host: new FormData(event.currentTarget).get("host") ?? "" });
    if (result.ok) {
      setError(null);
      toast.success(t("console.domains.baseSaved"));
      router.refresh();
    } else setError(result.error.fieldErrors?.host?.join(" ") ?? actionErrorMessage(result.error));
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-end" noValidate>
      <div className="flex flex-1 flex-col gap-1.5">
        <Label htmlFor="base-domain">{t("console.domains.baseDomain")}</Label>
        <Input
          id="base-domain"
          name="host"
          defaultValue={value ?? ""}
          aria-describedby="base-domain-hint"
        />
        <p id="base-domain-hint" className="text-xs text-muted-foreground">
          {t("console.domains.baseDomainHint")}
        </p>
      </div>
      <Button type="submit">{t("record.save")}</Button>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}
