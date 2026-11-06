"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@crm/ui/components/button";
import { Input } from "@crm/ui/components/input";
import { Label } from "@crm/ui/components/label";
import { NativeSelect } from "@crm/ui/components/native-select";
import { toast } from "@crm/ui/lib/toast";
import { actionErrorMessage } from "@crm/shared/auth-messages";
import type { ActionResult } from "@crm/shared/errors";
import { t, type MessageKey } from "@crm/shared/i18n";
import { CURRENCIES } from "@crm/shared/records/money";
import { DATE_FORMATS, LOCALES, THEMES, WEEK_STARTS } from "@crm/shared/records/schemas";
import {
  updatePipelineAction,
  updateProfileAction,
  updateTenantSettingsAction,
} from "@/features/records/actions";

// Settings forms (FR-SET-001/002, FR-DEAL-002). The server validates against IANA/ISO lists.

function useSubmit() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  async function submit<T>(fn: () => Promise<ActionResult<T>>, success: string) {
    setPending(true);
    const result = await fn();
    setPending(false);
    if (result.ok) {
      setErrors({});
      setFormError(null);
      toast.success(success);
      router.refresh();
      return;
    }
    setErrors(result.error.fieldErrors ?? {});
    setFormError(actionErrorMessage(result.error));
  }
  return { pending, errors, formError, submit };
}

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string[] | undefined;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error.join(" ")}
        </p>
      ) : null}
    </div>
  );
}

function FormError({ text }: { text: string | null }) {
  return text ? (
    <p role="alert" className="text-sm text-destructive">
      {text}
    </p>
  ) : null;
}

export interface WorkspaceSettingsValues {
  timezone: string;
  locale: string;
  currency: string;
  dateFormat: string;
  weekStart: string;
  fiscalYearStartMonth: number;
}

export function WorkspaceSettingsForm({
  values,
  timeZones,
  readOnly,
}: {
  values: WorkspaceSettingsValues;
  timeZones: string[];
  readOnly: boolean;
}) {
  const s = useSubmit();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    await s.submit(
      () =>
        updateTenantSettingsAction({
          timezone: d.get("timezone"),
          locale: d.get("locale"),
          currency: d.get("currency"),
          dateFormat: d.get("dateFormat"),
          weekStart: d.get("weekStart"),
          fiscalYearStartMonth: d.get("fiscalYearStartMonth"),
        }),
      t("settings.saved"),
    );
  }
  return (
    <form onSubmit={onSubmit} className="flex max-w-xl flex-col gap-4" noValidate>
      {readOnly ? <p className="text-sm text-muted-foreground">{t("settings.readOnly")}</p> : null}
      <FormError text={s.formError} />
      <fieldset disabled={readOnly} className="grid gap-4 sm:grid-cols-2">
        <Field id="ws-timezone" label={t("settings.timezone")} error={s.errors.timezone}>
          <NativeSelect id="ws-timezone" name="timezone" defaultValue={values.timezone}>
            {timeZones.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="ws-locale" label={t("settings.locale")} error={s.errors.locale}>
          <NativeSelect id="ws-locale" name="locale" defaultValue={values.locale}>
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field
          id="ws-currency"
          label={t("settings.currency")}
          error={s.errors.currency}
          hint={t("settings.currencyHint")}
        >
          <NativeSelect id="ws-currency" name="currency" defaultValue={values.currency}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="ws-dateFormat" label={t("settings.dateFormat")} error={s.errors.dateFormat}>
          <NativeSelect id="ws-dateFormat" name="dateFormat" defaultValue={values.dateFormat}>
            {DATE_FORMATS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="ws-weekStart" label={t("settings.weekStart")} error={s.errors.weekStart}>
          <NativeSelect id="ws-weekStart" name="weekStart" defaultValue={values.weekStart}>
            {WEEK_STARTS.map((w) => (
              <option key={w} value={w}>
                {t(`settings.weekStart.${w}` as MessageKey)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field
          id="ws-fiscal"
          label={t("settings.fiscalYear")}
          error={s.errors.fiscalYearStartMonth}
        >
          <Input
            id="ws-fiscal"
            name="fiscalYearStartMonth"
            type="number"
            min={1}
            max={12}
            defaultValue={values.fiscalYearStartMonth}
          />
        </Field>
      </fieldset>
      {readOnly ? null : (
        <div>
          <Button type="submit" disabled={s.pending}>
            {t("record.save")}
          </Button>
        </div>
      )}
    </form>
  );
}

export function ProfileForm({
  values,
  timeZones,
}: {
  values: { displayName: string; timezone: string | null; theme: string; email: string };
  timeZones: string[];
}) {
  const s = useSubmit();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    await s.submit(
      () =>
        updateProfileAction({
          displayName: d.get("displayName"),
          timezone: d.get("timezone"),
          theme: d.get("theme"),
        }),
      t("settings.profile.saved"),
    );
  }
  return (
    <form onSubmit={onSubmit} className="flex max-w-xl flex-col gap-4" noValidate>
      <FormError text={s.formError} />
      <p className="text-sm text-muted-foreground">{values.email}</p>
      <Field id="pf-name" label={t("settings.profile.displayName")} error={s.errors.displayName}>
        <Input
          id="pf-name"
          name="displayName"
          defaultValue={values.displayName}
          maxLength={120}
          required
        />
      </Field>
      <Field id="pf-tz" label={t("settings.profile.timezone")} error={s.errors.timezone}>
        <NativeSelect id="pf-tz" name="timezone" defaultValue={values.timezone ?? ""}>
          <option value="">{t("settings.profile.timezoneDefault")}</option>
          {timeZones.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id="pf-theme" label={t("settings.profile.theme")} error={s.errors.theme}>
        <NativeSelect id="pf-theme" name="theme" defaultValue={values.theme}>
          {THEMES.map((th) => (
            <option key={th} value={th}>
              {t(`settings.profile.theme.${th}` as MessageKey)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <div>
        <Button type="submit" disabled={s.pending}>
          {t("record.save")}
        </Button>
      </div>
    </form>
  );
}

interface StageRow {
  key: string;
  id: string | null;
  name: string;
  probability: number;
}

export function PipelineEditor({
  stages: initial,
  readOnly,
}: {
  stages: Array<{ id: string; name: string; probability: number }>;
  readOnly: boolean;
}) {
  const s = useSubmit();
  const [rows, setRows] = useState<StageRow[]>(initial.map((st) => ({ ...st, key: st.id })));
  const [moves, setMoves] = useState<Record<string, string>>({});
  const removed = initial.filter((st) => !rows.some((r) => r.id === st.id));
  const targets = rows.filter((r) => r.id);

  const update = (i: number, patch: Partial<StageRow>) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const swap = (i: number, j: number) => {
    const next = [...rows];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setRows(next);
  };

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fallback = targets[0]?.id ?? "";
    await s.submit(
      () =>
        updatePipelineAction({
          stages: rows.map((r) => ({ id: r.id ?? "", name: r.name, probability: r.probability })),
          moves: Object.fromEntries(removed.map((st) => [st.id, moves[st.id] ?? fallback])),
        }),
      t("settings.pipeline.saved"),
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-2xl flex-col gap-4" noValidate>
      <p className="text-sm text-muted-foreground">
        {readOnly ? t("settings.pipeline.readOnly") : t("settings.pipeline.body")}
      </p>
      <FormError text={s.formError} />
      <ol className="flex flex-col gap-2">
        {rows.map((row, i) => (
          <li key={row.key} className="flex flex-wrap items-end gap-2 rounded-lg border p-2">
            <div className="flex min-w-40 flex-1 flex-col gap-1.5">
              <Label htmlFor={`stage-name-${i}`}>
                {t("settings.pipeline.stage", { index: i + 1 })}
              </Label>
              <Input
                id={`stage-name-${i}`}
                value={row.name}
                maxLength={40}
                disabled={readOnly}
                onChange={(e) => update(i, { name: e.target.value })}
              />
            </div>
            <div className="flex w-28 flex-col gap-1.5">
              <Label htmlFor={`stage-prob-${i}`}>
                {t("settings.pipeline.probability", { index: i + 1 })}
              </Label>
              <Input
                id={`stage-prob-${i}`}
                type="number"
                min={0}
                max={100}
                value={row.probability}
                disabled={readOnly}
                onChange={(e) => update(i, { probability: Number(e.target.value) })}
              />
            </div>
            {readOnly ? null : (
              <div className="flex gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={i === 0}
                  aria-label={t("settings.pipeline.up", { index: i + 1 })}
                  onClick={() => swap(i, i - 1)}
                >
                  ↑
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={i === rows.length - 1}
                  aria-label={t("settings.pipeline.down", { index: i + 1 })}
                  onClick={() => swap(i, i + 1)}
                >
                  ↓
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={rows.length <= 2}
                  aria-label={t("settings.pipeline.remove", { index: i + 1 })}
                  onClick={() => setRows(rows.filter((_, j) => j !== i))}
                >
                  ×
                </Button>
              </div>
            )}
          </li>
        ))}
      </ol>
      {s.errors.stages ? (
        <p className="text-sm text-destructive">{s.errors.stages.join(" ")}</p>
      ) : null}
      {removed.map((st) => (
        <div key={st.id} className="flex flex-col gap-1.5">
          <Label htmlFor={`move-${st.id}`}>
            {t("settings.pipeline.moveTo", { name: st.name })}
          </Label>
          <NativeSelect
            id={`move-${st.id}`}
            value={moves[st.id] ?? targets[0]?.id ?? ""}
            onChange={(e) => setMoves({ ...moves, [st.id]: e.target.value })}
          >
            {targets.map((r) => (
              <option key={r.key} value={r.id!}>
                {r.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      ))}
      {readOnly ? null : (
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={rows.length >= 15}
            onClick={() =>
              setRows([...rows, { key: `new-${Date.now()}`, id: null, name: "", probability: 50 }])
            }
          >
            {t("settings.pipeline.add")}
          </Button>
          <Button type="submit" disabled={s.pending}>
            {t("record.save")}
          </Button>
        </div>
      )}
    </form>
  );
}
