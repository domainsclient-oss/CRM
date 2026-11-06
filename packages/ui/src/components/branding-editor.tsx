"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@crm/ui/components/button";
import { Input } from "@crm/ui/components/input";
import { Label } from "@crm/ui/components/label";
import { toast } from "@crm/ui/lib/toast";
import { actionErrorMessage } from "@crm/shared/auth-messages";
import type { BrandAssetKind } from "@crm/shared/branding/schemas";
import { HEX_COLOR, deriveTheme } from "@crm/shared/branding/theme";
import type { ActionResult } from "@crm/shared/errors";
import { t, type MessageKey } from "@crm/shared/i18n";

// Branding editor (FR-BRAND-001/002) used by workspace settings and the consoles. Values left
// empty inherit from the level above. The preview derives the theme with the same function the
// server uses on save, so contrast problems show before saving; the server re-validates.

export interface BrandingValues {
  appName: string | null;
  primaryColor: string | null;
  accentColor: string | null;
}

interface Props {
  own: BrandingValues;
  inherited: { appName: string; primaryColor: string; accentColor: string };
  assets: Record<BrandAssetKind, string | null>;
  readOnly?: boolean;
  onSave: (values: BrandingValues) => Promise<ActionResult<unknown>>;
  onUpload: (kind: BrandAssetKind, file: File) => Promise<ActionResult<unknown>>;
  onRemove: (kind: BrandAssetKind) => Promise<ActionResult<unknown>>;
  /** Called after a successful change (e.g. router.refresh). */
  onChanged: () => void;
}

const KINDS: BrandAssetKind[] = ["logoLight", "logoDark", "favicon"];
const blankToNull = (v: string) => (v.trim() === "" ? null : v.trim());

export function BrandingEditor({
  own,
  inherited,
  assets,
  readOnly,
  onSave,
  onUpload,
  onRemove,
  onChanged,
}: Props) {
  const [values, setValues] = useState({
    appName: own.appName ?? "",
    primaryColor: own.primaryColor ?? "",
    accentColor: own.accentColor ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, setPending] = useState(false);

  const effective = {
    appName: blankToNull(values.appName) ?? inherited.appName,
    primary: HEX_COLOR.test(values.primaryColor) ? values.primaryColor : inherited.primaryColor,
    accent: HEX_COLOR.test(values.accentColor) ? values.accentColor : inherited.accentColor,
  };
  const derived = deriveTheme(effective.primary, effective.accent);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const result = await onSave({
      appName: blankToNull(values.appName),
      primaryColor: blankToNull(values.primaryColor),
      accentColor: blankToNull(values.accentColor),
    });
    setPending(false);
    if (result.ok) {
      setErrors({});
      toast.success(t("branding.saved"));
      onChanged();
    } else {
      setErrors(result.error.fieldErrors ?? { _form: [actionErrorMessage(result.error)] });
    }
  }

  async function upload(kind: BrandAssetKind, input: HTMLInputElement) {
    const file = input.files?.[0];
    if (!file) return;
    setPending(true);
    const result = await onUpload(kind, file);
    setPending(false);
    input.value = "";
    if (result.ok) {
      setErrors({});
      toast.success(t("branding.uploaded"));
      onChanged();
    } else {
      setErrors({
        [`asset.${kind}`]: result.error.fieldErrors?.file ?? [actionErrorMessage(result.error)],
      });
    }
  }

  async function remove(kind: BrandAssetKind) {
    setPending(true);
    const result = await onRemove(kind);
    setPending(false);
    if (result.ok) {
      toast.success(t("branding.removed"));
      onChanged();
    } else toast.error(actionErrorMessage(result.error));
  }

  const colourField = (
    name: "primaryColor" | "accentColor",
    label: MessageKey,
    inheritedValue: string,
  ) => {
    const err = errors[name]?.join(" ");
    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`brand-${name}`}>{t(label)}</Label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-hidden
            tabIndex={-1}
            className="size-8 shrink-0 rounded border"
            value={HEX_COLOR.test(values[name]) ? values[name] : inheritedValue}
            disabled={readOnly}
            onChange={(e) => setValues({ ...values, [name]: e.target.value.toUpperCase() })}
          />
          <Input
            id={`brand-${name}`}
            value={values[name]}
            placeholder={inheritedValue}
            maxLength={7}
            disabled={readOnly}
            aria-invalid={err ? true : undefined}
            aria-describedby={`brand-${name}-hint${err ? ` brand-${name}-error` : ""}`}
            onChange={(e) => setValues({ ...values, [name]: e.target.value })}
          />
        </div>
        <p id={`brand-${name}-hint`} className="text-xs text-muted-foreground">
          {t("branding.colourHint")} {t("branding.inherited", { value: inheritedValue })}
        </p>
        {err ? (
          <p id={`brand-${name}-error`} className="text-sm text-destructive">
            {err}
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <form onSubmit={onSubmit} noValidate className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          {errors._form ? (
            <p role="alert" className="text-sm text-destructive">
              {errors._form.join(" ")}
            </p>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="brand-appName">{t("branding.appName")}</Label>
            <Input
              id="brand-appName"
              value={values.appName}
              placeholder={inherited.appName}
              maxLength={40}
              disabled={readOnly}
              aria-invalid={errors.appName ? true : undefined}
              aria-describedby="brand-appName-hint"
              onChange={(e) => setValues({ ...values, appName: e.target.value })}
            />
            <p id="brand-appName-hint" className="text-xs text-muted-foreground">
              {t("branding.appNameHint", { inherited: inherited.appName })}
            </p>
            {errors.appName ? (
              <p className="text-sm text-destructive">{errors.appName.join(" ")}</p>
            ) : null}
          </div>
          {colourField("primaryColor", "branding.primary", inherited.primaryColor)}
          {colourField("accentColor", "branding.accent", inherited.accentColor)}
          {!derived.ok ? (
            <p role="alert" className="text-sm text-destructive">
              {t("branding.contrastError", { suggestion: derived.suggestion ?? "—" })}
            </p>
          ) : null}
          {readOnly ? null : (
            <div>
              <Button type="submit" disabled={pending || !derived.ok}>
                {t("record.save")}
              </Button>
            </div>
          )}
        </div>

        <section aria-label={t("branding.preview")} className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">{t("branding.preview")}</h2>
          {derived.ok
            ? (["light", "dark"] as const).map((mode) => {
                const surface = mode === "light" ? "#FFFFFF" : "#0A0A0A";
                const text = mode === "light" ? "#111827" : "#F4F4F5";
                const link =
                  mode === "light"
                    ? derived.theme.primaryOnSurface
                    : derived.theme.primaryOnSurfaceDark;
                return (
                  <div
                    key={mode}
                    className="flex flex-col gap-3 rounded-xl border p-4"
                    style={{ background: surface, color: text }}
                  >
                    <span className="text-xs opacity-70">
                      {t(mode === "light" ? "branding.previewLight" : "branding.previewDark")}
                    </span>
                    <strong>{effective.appName}</strong>
                    <div className="flex flex-wrap items-center gap-3">
                      <span
                        className="rounded-md px-3 py-1.5 text-sm font-medium"
                        style={{
                          background: derived.theme.primary,
                          color: derived.theme.primaryFg,
                          outline: `2px solid ${mode === "light" ? derived.theme.focusRing : derived.theme.focusRingDark}`,
                          outlineOffset: 2,
                        }}
                      >
                        {t("branding.previewButton")}
                      </span>
                      <span className="text-sm underline" style={{ color: link }}>
                        {t("branding.previewLink")}
                      </span>
                      <span
                        className="rounded-full px-2 py-0.5 text-xs"
                        style={{ background: derived.theme.accent, color: derived.theme.accentFg }}
                      >
                        {t("branding.accent")}
                      </span>
                    </div>
                  </div>
                );
              })
            : null}
        </section>
      </form>

      <section className="flex flex-col gap-4" aria-label={t("branding.images")}>
        {KINDS.map((kind) => {
          const label = t(`branding.${kind}` as MessageKey);
          const err = errors[`asset.${kind}`]?.join(" ");
          return (
            <div key={kind} className="flex flex-wrap items-center gap-4 rounded-xl border p-4">
              <div className="flex h-12 w-32 items-center justify-center rounded border bg-muted/40">
                {assets[kind] ? (
                  // eslint-disable-next-line @next/next/no-img-element -- same-origin content-hashed asset
                  <img
                    src={assets[kind]!}
                    alt={t("branding.current", { kind: label })}
                    className="max-h-10 max-w-28 object-contain"
                  />
                ) : (
                  <span className="px-2 text-center text-xs text-muted-foreground">
                    {t("branding.none")}
                  </span>
                )}
              </div>
              <div className="flex min-w-48 flex-1 flex-col gap-1.5">
                <Label htmlFor={`asset-${kind}`}>{label}</Label>
                <input
                  id={`asset-${kind}`}
                  type="file"
                  accept={kind === "favicon" ? "image/png" : "image/png,image/jpeg,image/webp"}
                  disabled={readOnly || pending}
                  aria-describedby={`asset-${kind}-hint${err ? ` asset-${kind}-error` : ""}`}
                  aria-invalid={err ? true : undefined}
                  className="text-sm"
                  onChange={(e) => upload(kind, e.currentTarget)}
                />
                <p id={`asset-${kind}-hint`} className="text-xs text-muted-foreground">
                  {t(kind === "favicon" ? "branding.faviconHint" : "branding.assetHint")}
                </p>
                {err ? (
                  <p id={`asset-${kind}-error`} role="alert" className="text-sm text-destructive">
                    {err}
                  </p>
                ) : null}
              </div>
              {assets[kind] && !readOnly ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => remove(kind)}
                >
                  {t("branding.remove", { kind: label })}
                </Button>
              ) : null}
            </div>
          );
        })}
      </section>
    </div>
  );
}
