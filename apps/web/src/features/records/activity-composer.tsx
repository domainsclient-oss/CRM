"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@crm/ui/components/button";
import { Input } from "@crm/ui/components/input";
import { Label } from "@crm/ui/components/label";
import { NativeSelect } from "@crm/ui/components/native-select";
import { Textarea } from "@crm/ui/components/textarea";
import { toast } from "@crm/ui/lib/toast";
import { actionErrorMessage } from "@crm/shared/auth-messages";
import { t, type MessageKey } from "@crm/shared/i18n";
import { ACTIVITY_TYPES, type RelatedType } from "@crm/shared/records/schemas";
import { deleteActivityAction, logActivityAction } from "./actions";

// Activity composer (FR-ACT-001). Date/time default to "now" in the viewer's zone (passed from
// the server); the server converts to UTC.

export function ActivityComposer({
  related,
  today,
  now,
}: {
  related: { type: RelatedType; id: string };
  today: string;
  now: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    const result = await logActivityAction({
      values: {
        type: data.get("type"),
        subject: data.get("subject"),
        body: data.get("body"),
        occurredDate: data.get("occurredDate"),
        occurredTime: data.get("occurredTime"),
        durationMinutes: data.get("durationMinutes"),
        outcome: data.get("outcome"),
        related: [related],
      },
    });
    setPending(false);
    if (result.ok) {
      form.reset();
      setErrors({});
      setFormError(null);
      toast.success(t("timeline.logged"));
      router.refresh();
      return;
    }
    setErrors(
      Object.fromEntries(
        Object.entries(result.error.fieldErrors ?? {}).map(([k, v]) => [
          k.replace(/^values\./, ""),
          v,
        ]),
      ),
    );
    setFormError(actionErrorMessage(result.error));
  }

  const err = (name: string) => errors[name]?.join(" ");
  const input = (name: string) => ({
    id: `act-${name}`,
    name,
    "aria-invalid": err(name) ? true : undefined,
    "aria-describedby": err(name) ? `act-${name}-error` : undefined,
  });
  const errorText = (name: string) =>
    err(name) ? (
      <p id={`act-${name}-error`} className="text-sm text-destructive">
        {err(name)}
      </p>
    ) : null;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3 rounded-xl border p-4">
      <h3 className="font-medium">{t("timeline.log")}</h3>
      {formError ? (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="act-type">{t("timeline.type")}</Label>
          <NativeSelect {...input("type")} defaultValue="note">
            {ACTIVITY_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`timeline.type.${type}` as MessageKey)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="act-subject">{t("timeline.subject")}</Label>
          <Input {...input("subject")} maxLength={200} required />
          {errorText("subject")}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="act-body">{t("timeline.body")}</Label>
        <Textarea {...input("body")} maxLength={10_000} rows={3} aria-describedby="act-body-hint" />
        <p id="act-body-hint" className="text-xs text-muted-foreground">
          {t("timeline.bodyHint")}
        </p>
        {errorText("body")}
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="act-occurredDate">{t("timeline.date")}</Label>
          <Input {...input("occurredDate")} type="date" defaultValue={today} required />
          {errorText("occurredDate")}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="act-occurredTime">{t("timeline.time")}</Label>
          <Input {...input("occurredTime")} type="time" defaultValue={now} required />
          {errorText("occurredTime")}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="act-durationMinutes">{t("timeline.duration")}</Label>
          <Input {...input("durationMinutes")} type="number" min={0} max={1440} />
          {errorText("durationMinutes")}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="act-outcome">{t("timeline.outcome")}</Label>
          <Input {...input("outcome")} maxLength={120} />
          {errorText("outcome")}
        </div>
      </div>
      <div>
        <Button type="submit" disabled={pending}>
          {t("timeline.log")}
        </Button>
      </div>
    </form>
  );
}

export function DeleteActivityButton({ id, subject }: { id: string; subject: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      aria-label={t("timeline.delete", { subject })}
      onClick={async () => {
        setPending(true);
        const result = await deleteActivityAction({ id });
        setPending(false);
        if (result.ok) {
          toast.success(t("timeline.deleted"));
          router.refresh();
        } else {
          toast.error(actionErrorMessage(result.error));
        }
      }}
    >
      ×
    </Button>
  );
}
