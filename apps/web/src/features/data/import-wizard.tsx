"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@crm/ui/components/button";
import { Label } from "@crm/ui/components/label";
import { NativeSelect } from "@crm/ui/components/native-select";
import { toast } from "@crm/ui/lib/toast";
import { actionErrorMessage } from "@crm/shared/auth-messages";
import type { ActionResult } from "@crm/shared/errors";
import { t, type MessageKey } from "@crm/shared/i18n";
import {
  DUPLICATE_MODES,
  IMPORT_ENTITIES,
  IMPORT_FIELDS,
  type DuplicateMode,
  type ImportEntity,
} from "@crm/shared/import";
import { previewImportAction, startImportAction } from "./actions";

// CSV import wizard (FR-IMP-001): upload (route handler, ≤ 10 MB) → column mapping (suggested)
// → validation preview → duplicate handling → run as a background job.

interface Preview {
  header: string[];
  mapping: Array<string | null>;
  rowCount: number;
  errorCount: number;
  preview: Array<{ row: number; cells: string[]; error: string | null }>;
}

export function ImportWizard() {
  const router = useRouter();
  const [entity, setEntity] = useState<ImportEntity>("contacts");
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mode, setMode] = useState<DuplicateMode>("skip");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function show(result: ActionResult<unknown>) {
    if (!result.ok) {
      setError(
        result.error.fieldErrors?.file?.join(" ") ??
          result.error.fieldErrors?.mapping?.join(" ") ??
          actionErrorMessage(result.error),
      );
      return;
    }
    setError(null);
    setPreview(result.data as Preview);
  }

  async function onUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    const res = await fetch("/api/imports", {
      method: "POST",
      body: data,
      headers: { "X-CRM-Request": "1" },
    });
    const body = (await res.json()) as ActionResult<{ uploadId: string }>;
    if (!body.ok) {
      setPending(false);
      return show(body);
    }
    setUploadId(body.data.uploadId);
    await show(await previewImportAction({ uploadId: body.data.uploadId, entity, mapping: null }));
    setPending(false);
  }

  async function remap(index: number, field: string) {
    if (!preview || !uploadId) return;
    const mapping = preview.mapping.map((m, i) =>
      i === index ? field || null : m === field ? null : m,
    );
    await show(await previewImportAction({ uploadId, entity, mapping }));
  }

  async function run() {
    if (!preview || !uploadId) return;
    setPending(true);
    const result = await startImportAction({
      uploadId,
      entity,
      mapping: preview.mapping,
      duplicateMode: mode,
    });
    setPending(false);
    if (!result.ok) {
      setError(
        result.error.code === "PLAN_LIMIT_EXCEEDED"
          ? t("import.limit")
          : actionErrorMessage(result.error),
      );
      return;
    }
    toast.success(t("import.started"));
    setPreview(null);
    setUploadId(null);
    router.refresh();
  }

  const fields = Object.keys(IMPORT_FIELDS[entity]);

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <form onSubmit={onUpload} className="flex flex-col gap-3 sm:flex-row sm:items-end" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="import-entity">{t("import.entity")}</Label>
          <NativeSelect
            id="import-entity"
            value={entity}
            onChange={(e) => {
              setEntity(e.target.value as ImportEntity);
              setPreview(null);
            }}
          >
            {IMPORT_ENTITIES.map((e) => (
              <option key={e} value={e}>
                {t(`entity.${e}.plural` as MessageKey)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="import-file">{t("import.file")}</Label>
          <input
            id="import-file"
            name="file"
            type="file"
            accept=".csv,text/csv"
            required
            className="text-sm"
          />
        </div>
        <Button type="submit" disabled={pending}>
          {t("import.upload")}
        </Button>
      </form>

      {preview ? (
        <>
          <section aria-label={t("import.mapping")} className="flex flex-col gap-2">
            <h2 className="text-lg font-medium">{t("import.mapping")}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {preview.header.map((column, i) => (
                <div key={`${column}-${i}`} className="flex flex-col gap-1.5">
                  <Label htmlFor={`map-${i}`}>
                    {t("import.mapTo", { column: column || `#${i + 1}` })}
                  </Label>
                  <NativeSelect
                    id={`map-${i}`}
                    value={preview.mapping[i] ?? ""}
                    onChange={(e) => remap(i, e.target.value)}
                  >
                    <option value="">{t("import.skip")}</option>
                    {fields.map((f) => (
                      <option key={f} value={f}>
                        {t(
                          `field.${f === "phone" && entity === "contacts" ? "phones" : f === "city" ? "address.city" : f === "country" ? "address.country" : f}` as MessageKey,
                        )}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              ))}
            </div>
          </section>
          <section aria-label={t("import.preview")} className="flex flex-col gap-2">
            <h2 className="text-lg font-medium">{t("import.preview")}</h2>
            <p role="status" className="text-sm">
              {t("import.errors", { count: preview.errorCount })}
            </p>
            <div
              className="overflow-x-auto rounded-xl border"
              role="region"
              tabIndex={0}
              aria-label={t("import.preview")}
            >
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th scope="col" className="px-2 py-1">
                      {t("import.row")}
                    </th>
                    {preview.header.map((h, i) => (
                      <th key={i} scope="col" className="px-2 py-1">
                        {h}
                      </th>
                    ))}
                    <th scope="col" className="px-2 py-1">
                      {t("import.reason")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {preview.preview.map((r) => (
                    <tr key={r.row} className={`border-t ${r.error ? "bg-destructive/5" : ""}`}>
                      <th scope="row" className="px-2 py-1 text-left font-normal">
                        {r.row}
                      </th>
                      {r.cells.map((c, i) => (
                        <td key={i} className="px-2 py-1">
                          {c}
                        </td>
                      ))}
                      <td className="px-2 py-1 text-destructive">{r.error ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{t("import.duplicates")}</legend>
            {DUPLICATE_MODES.map((m) => (
              <div key={m} className="flex items-center gap-2">
                <input
                  id={`dup-${m}`}
                  type="radio"
                  name="dup"
                  checked={mode === m}
                  onChange={() => setMode(m)}
                  className="size-4"
                />
                <Label htmlFor={`dup-${m}`}>{t(`import.dup.${m}` as MessageKey)}</Label>
              </div>
            ))}
          </fieldset>
          <div>
            <Button onClick={run} disabled={pending || preview.rowCount === preview.errorCount}>
              {t("import.run", { count: preview.rowCount - preview.errorCount })}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
