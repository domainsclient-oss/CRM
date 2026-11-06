"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@crm/ui/components/button";
import { Input } from "@crm/ui/components/input";
import { Label } from "@crm/ui/components/label";
import type { ActionResult } from "@crm/shared/errors";
import { t } from "@crm/shared/i18n";
import { ActionError, newIdempotencyKey } from "./action-feedback";

function Field({
  name,
  label,
  type = "text",
  errors,
  ...rest
}: {
  name: string;
  label: string;
  type?: string;
  errors?: string[] | undefined;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const errorId = `${name}-error`;
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type={type}
        aria-invalid={Boolean(errors?.length)}
        aria-describedby={errors?.length ? errorId : undefined}
        {...rest}
      />
      {errors?.length ? (
        <p id={errorId} className="text-sm text-destructive">
          {errors.join(" ")}
        </p>
      ) : null}
    </div>
  );
}

function useSubmit<T>(
  submit: (form: FormData, idempotencyKey: string) => Promise<ActionResult<T>>,
  successMessage: (data: T) => string,
) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ActionResult<T> | null>(null);
  // One key per form instance: a double submit can't provision twice (FR-TEN-001 AC4).
  const [key, setKey] = useState(newIdempotencyKey);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    setPending(true);
    const r = await submit(new FormData(formEl), key);
    setResult(r);
    setPending(false);
    if (r.ok) {
      formEl.reset();
      setKey(newIdempotencyKey());
      router.refresh();
    }
  }
  const success = result?.ok ? (
    <p role="status" className="text-sm">
      {successMessage(result.data)}
    </p>
  ) : null;
  const fieldErrors = result && !result.ok ? (result.error.fieldErrors ?? {}) : {};
  return { onSubmit, pending, result, success, fieldErrors };
}

function FormShell({
  title,
  children,
  onSubmit,
  pending,
  submitLabel,
  feedback,
}: {
  title: string;
  children: ReactNode;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  pending: boolean;
  submitLabel: string;
  feedback: ReactNode;
}) {
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-xl border p-4" noValidate>
      <h2 className="text-lg font-medium">{title}</h2>
      {children}
      <div>
        <Button type="submit" disabled={pending}>
          {submitLabel}
        </Button>
      </div>
      {feedback}
    </form>
  );
}

export function CreateAgencyForm({
  action,
}: {
  action: (input: unknown) => Promise<ActionResult<{ agencyId: string }>>;
}) {
  const { onSubmit, pending, result, success, fieldErrors } = useSubmit(
    (f, idempotencyKey) =>
      action({
        name: f.get("name"),
        slug: f.get("slug"),
        ownerEmail: f.get("ownerEmail"),
        maxWorkspaces: f.get("maxWorkspaces"),
        maxSeatsTotal: f.get("maxSeatsTotal"),
        canProvisionWorkspaces: f.get("canProvisionWorkspaces") === "on",
        idempotencyKey,
      }),
    () => t("console.created.agency"),
  );
  return (
    <FormShell
      title={t("console.create.agency")}
      onSubmit={onSubmit}
      pending={pending}
      submitLabel={t("console.create.agency")}
      feedback={success ?? <ActionError result={result} />}
    >
      <Field name="name" label={t("console.form.name")} required errors={fieldErrors.name} />
      <Field name="slug" label={t("console.form.slug")} required errors={fieldErrors.slug} />
      <Field
        name="ownerEmail"
        type="email"
        label={t("console.form.ownerEmail")}
        required
        errors={fieldErrors.ownerEmail}
      />
      <Field
        name="maxWorkspaces"
        type="number"
        min={1}
        defaultValue={10}
        label={t("console.form.maxWorkspaces")}
        errors={fieldErrors.maxWorkspaces}
      />
      <Field
        name="maxSeatsTotal"
        type="number"
        min={1}
        defaultValue={100}
        label={t("console.form.maxSeats")}
        errors={fieldErrors.maxSeatsTotal}
      />
      <div className="flex items-center gap-2">
        <input
          id="canProvisionWorkspaces"
          name="canProvisionWorkspaces"
          type="checkbox"
          className="size-4"
        />
        <Label htmlFor="canProvisionWorkspaces">{t("console.form.canProvision")}</Label>
      </div>
    </FormShell>
  );
}

export function CreateWorkspaceForm({
  action,
  agencies,
}: {
  action: (input: unknown) => Promise<ActionResult<{ tenantId: string; host: string }>>;
  /** Platform console only; agency staff never choose an agency. */
  agencies?: Array<{ id: string; name: string }> | undefined;
}) {
  const { onSubmit, pending, result, success, fieldErrors } = useSubmit(
    (f, idempotencyKey) =>
      action({
        ...(agencies ? { agencyId: f.get("agencyId") } : {}),
        name: f.get("name"),
        slug: f.get("slug"),
        ownerEmail: f.get("ownerEmail"),
        idempotencyKey,
      }),
    (data) => t("console.created.workspace", { host: data.host }),
  );
  return (
    <FormShell
      title={t("console.create.workspace")}
      onSubmit={onSubmit}
      pending={pending}
      submitLabel={t("console.create.workspace")}
      feedback={success ?? <ActionError result={result} />}
    >
      {agencies ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="agencyId">{t("console.form.agency")}</Label>
          <select
            id="agencyId"
            name="agencyId"
            required
            className="h-9 rounded-md border bg-background px-3 text-sm"
          >
            {agencies.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <Field name="name" label={t("console.form.name")} required errors={fieldErrors.name} />
      <Field name="slug" label={t("console.form.slug")} required errors={fieldErrors.slug} />
      <Field
        name="ownerEmail"
        type="email"
        label={t("console.form.ownerEmail")}
        required
        errors={fieldErrors.ownerEmail}
      />
    </FormShell>
  );
}
