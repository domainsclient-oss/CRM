"use client";

import { useState } from "react";
import { Button } from "@crm/ui/components/button";
import { Input } from "@crm/ui/components/input";
import { Label } from "@crm/ui/components/label";
import { NativeSelect } from "@crm/ui/components/native-select";
import { Textarea } from "@crm/ui/components/textarea";
import { toast } from "@crm/ui/lib/toast";
import { actionErrorMessage } from "@crm/shared/auth-messages";
import type { OverridableEmail } from "@crm/shared/branding/schemas";
import { t, type MessageKey } from "@crm/shared/i18n";
import { previewEmailAction, saveEmailOverrideAction, sendTestEmailAction } from "./actions";

// Email subject/intro overrides with preview and test send (FR-BRAND-003). The preview HTML is
// produced by the server renderer (escaped) and shown in a fully sandboxed iframe.

interface Override {
  template: OverridableEmail;
  subject: string | null;
  intro: string | null;
}

export function EmailTemplates({ overrides }: { overrides: Override[] }) {
  const [template, setTemplate] = useState<OverridableEmail>(overrides[0]!.template);
  const current = overrides.find((o) => o.template === template)!;
  const [subject, setSubject] = useState(current.subject ?? "");
  const [intro, setIntro] = useState(current.intro ?? "");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [pending, setPending] = useState(false);

  function choose(next: OverridableEmail) {
    const o = overrides.find((x) => x.template === next)!;
    setTemplate(next);
    setSubject(o.subject ?? "");
    setIntro(o.intro ?? "");
    setErrors({});
    setPreview(null);
  }

  const draft = () => ({ template, subject: subject || null, intro: intro || null });

  async function run(kind: "save" | "preview" | "test") {
    setPending(true);
    const result =
      kind === "save"
        ? await saveEmailOverrideAction(draft())
        : kind === "preview"
          ? await previewEmailAction(draft())
          : await sendTestEmailAction({ template });
    setPending(false);
    if (!result.ok) {
      setErrors(result.error.fieldErrors ?? {});
      toast.error(actionErrorMessage(result.error));
      return;
    }
    setErrors({});
    if (kind === "save") toast.success(t("emails.saved"));
    if (kind === "preview") setPreview(result.data as { subject: string; html: string });
    if (kind === "test") {
      toast.success(t("emails.testSent", { email: (result.data as { email: string }).email }));
    }
  }

  return (
    <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email-template">{t("emails.template")}</Label>
          <NativeSelect
            id="email-template"
            value={template}
            onChange={(e) => choose(e.target.value as OverridableEmail)}
          >
            {overrides.map((o) => (
              <option key={o.template} value={o.template}>
                {t(`emails.name.${o.template}` as MessageKey)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email-subject">{t("emails.subject")}</Label>
          <Input
            id="email-subject"
            value={subject}
            maxLength={120}
            aria-invalid={errors.subject ? true : undefined}
            aria-describedby="email-default-hint"
            onChange={(e) => setSubject(e.target.value)}
          />
          {errors.subject ? (
            <p className="text-sm text-destructive">{errors.subject.join(" ")}</p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email-intro">{t("emails.intro")}</Label>
          <Textarea
            id="email-intro"
            value={intro}
            maxLength={500}
            rows={4}
            aria-invalid={errors.intro ? true : undefined}
            aria-describedby="email-default-hint"
            onChange={(e) => setIntro(e.target.value)}
          />
          {errors.intro ? (
            <p className="text-sm text-destructive">{errors.intro.join(" ")}</p>
          ) : null}
          <p id="email-default-hint" className="text-xs text-muted-foreground">
            {t("emails.defaultHint")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={pending} onClick={() => run("save")}>
            {t("record.save")}
          </Button>
          <Button variant="outline" disabled={pending} onClick={() => run("preview")}>
            {t("emails.preview")}
          </Button>
          <Button variant="outline" disabled={pending} onClick={() => run("test")}>
            {t("emails.testSend")}
          </Button>
        </div>
      </div>
      {preview ? (
        <section aria-label={t("emails.preview")} className="flex flex-col gap-2">
          <p className="text-sm">
            <span className="text-muted-foreground">{t("emails.subject")}:</span>{" "}
            <strong data-testid="email-preview-subject">{preview.subject}</strong>
          </p>
          <iframe
            title={t("emails.previewFrame")}
            sandbox=""
            srcDoc={preview.html}
            className="h-[28rem] w-full rounded-lg border bg-white"
          />
        </section>
      ) : null}
    </div>
  );
}
