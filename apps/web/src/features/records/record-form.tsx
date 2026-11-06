"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@crm/ui/components/button";
import { Input } from "@crm/ui/components/input";
import { Label } from "@crm/ui/components/label";
import { NativeSelect } from "@crm/ui/components/native-select";
import { Textarea } from "@crm/ui/components/textarea";
import { toast } from "@crm/ui/lib/toast";
import { actionErrorMessage } from "@crm/shared/auth-messages";
import type { ActionResult } from "@crm/shared/errors";
import { t, type MessageKey } from "@crm/shared/i18n";
import type { ListEntity } from "@crm/shared/records/list-specs";
import { PHONE_LABELS, RELATED_TYPES } from "@crm/shared/records/schemas";
import {
  checkDuplicateAction,
  saveCompanyAction,
  saveContactAction,
  saveDealAction,
  saveLeadAction,
  saveTaskAction,
} from "./actions";
import { FORM_FIELDS, enumLabel, type FieldSpec } from "./config";
import { TagInput } from "./tag-input";

// Create/edit form driven by FORM_FIELDS (T-04-02..06). Inline errors come from the server's
// strict validation (authoritative); the form keeps the user's input on any failure.

type Option = { id: string; label: string };
export interface FormOptionsProps {
  members: Option[];
  companies: Option[];
  contacts: Option[];
  leads: Option[];
  deals: Option[];
  stages: Option[];
  tags: string[];
  canReassign: boolean;
}

type Values = Record<string, unknown>;
type SaveResult = ActionResult<{ id: string }>;

const SAVE: Record<ListEntity, (input: unknown) => Promise<SaveResult>> = {
  companies: saveCompanyAction,
  contacts: saveContactAction,
  leads: saveLeadAction,
  deals: saveDealAction,
  tasks: saveTaskAction,
};

const ADDRESS_PARTS = ["line1", "line2", "city", "region", "postalCode", "country"] as const;

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const label = (name: string) => t(`field.${name}` as MessageKey);

interface Props {
  entity: ListEntity;
  id: string | null;
  expectedUpdatedAt: string | null;
  initial: Values;
  options: FormOptionsProps;
  cancelHref: string;
}

export function RecordForm({ entity, id, expectedUpdatedAt, initial, options, cancelHref }: Props) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<{ text: string; conflict: boolean } | null>(null);
  const [pending, setPending] = useState(false);
  const [tags, setTags] = useState<string[]>((initial.tags as string[] | undefined) ?? []);
  const [phones, setPhones] = useState<Array<{ label: string; number: string }>>(
    (initial.phones as Array<{ label: string; number: string }> | undefined) ?? [],
  );
  const [relatedType, setRelatedType] = useState(
    str((initial.related as { type?: string } | null)?.type) || "contact",
  );
  const [duplicate, setDuplicate] = useState<ReactNode>(null);
  const fields = FORM_FIELDS[entity].filter(
    (f) => !(f.kind === "member" && f.name === "ownerUid" && !options.canReassign),
  );

  function collect(form: HTMLFormElement): Values {
    const data = new FormData(form);
    const values: Values = {};
    for (const f of fields) {
      switch (f.kind) {
        case "checkbox":
          values[f.name] = data.get(f.name) === "on";
          break;
        case "tags":
          values[f.name] = tags;
          break;
        case "phones":
          values[f.name] = phones.filter((p) => p.number.trim() !== "");
          break;
        case "address":
          values[f.name] = Object.fromEntries(
            ADDRESS_PARTS.map((p) => [p, String(data.get(`address.${p}`) ?? "")]),
          );
          break;
        case "related": {
          const relId = String(data.get("related.id") ?? "");
          values[f.name] = relId ? { type: relatedType, id: relId } : null;
          break;
        }
        default:
          values[f.name] = String(data.get(f.name) ?? "");
      }
    }
    return values;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFormError(null);
    const result = await SAVE[entity]({
      id,
      expectedUpdatedAt,
      values: collect(event.currentTarget),
    });
    setPending(false);
    if (result.ok) {
      toast.success(t(id ? "record.saved" : "record.created"));
      router.push(`/${entity}/${result.data.id}`);
      router.refresh();
      return;
    }
    const fieldErrors = Object.fromEntries(
      Object.entries(result.error.fieldErrors ?? {}).map(([k, v]) => [
        k.replace(/^values\./, ""),
        v,
      ]),
    );
    setErrors(fieldErrors);
    const conflict = result.error.code === "CONFLICT";
    setFormError({
      text: conflict ? t("record.conflict") : actionErrorMessage(result.error),
      conflict,
    });
    const first = Object.keys(fieldErrors)[0];
    if (first)
      formRef.current?.querySelector<HTMLElement>(`[data-field="${first.split(".")[0]}"]`)?.focus();
  }

  async function checkDuplicate(kind: "company" | "contact", value: string) {
    if (!value.trim()) return setDuplicate(null);
    const result = await checkDuplicateAction({ type: kind, value, excludeId: id });
    if (!result.ok || result.data.status === "none") return setDuplicate(null);
    const field = label(kind === "company" ? "domain" : "email").toLowerCase();
    setDuplicate(
      result.data.status === "hidden" ? (
        t("record.dupHidden")
      ) : (
        <>
          {t("record.dupVisible", { field })}{" "}
          <Link
            href={`/${kind === "company" ? "companies" : "contacts"}/${result.data.id}`}
            className="underline underline-offset-4"
          >
            {result.data.label}
          </Link>
        </>
      ),
    );
  }

  function errorFor(name: string) {
    const list = Object.entries(errors)
      .filter(([k]) => k === name || k.startsWith(`${name}.`))
      .flatMap(([, v]) => v);
    return list.length > 0 ? list.join(" ") : null;
  }

  function field(f: FieldSpec) {
    const err = errorFor(f.name);
    const errId = err ? `${f.name}-error` : undefined;
    const common = {
      id: `f-${f.name}`,
      name: f.name,
      "data-field": f.name,
      "aria-invalid": err ? true : undefined,
      "aria-describedby": errId,
    } as const;
    let control: ReactNode;
    let wide = false;
    switch (f.kind) {
      case "text":
      case "email":
      case "url":
      case "tel":
        control = (
          <Input
            {...common}
            type={f.kind}
            defaultValue={str(initial[f.name])}
            required={f.required}
            maxLength={f.maxLength}
            autoComplete={f.autoComplete}
            onBlur={
              (entity === "contacts" && f.name === "email") ||
              (entity === "companies" && f.name === "domain")
                ? (e) =>
                    checkDuplicate(entity === "contacts" ? "contact" : "company", e.target.value)
                : undefined
            }
          />
        );
        break;
      case "money":
        control = (
          <Input
            {...common}
            inputMode="decimal"
            defaultValue={str(initial[f.name])}
            maxLength={20}
          />
        );
        break;
      case "number":
        control = (
          <Input
            {...common}
            type="number"
            min={f.min}
            max={f.max}
            step={1}
            defaultValue={str(initial[f.name])}
          />
        );
        break;
      case "date":
      case "time":
        control = <Input {...common} type={f.kind} defaultValue={str(initial[f.name])} />;
        break;
      case "textarea":
        wide = true;
        control = (
          <Textarea
            {...common}
            defaultValue={str(initial[f.name])}
            maxLength={f.maxLength}
            rows={4}
          />
        );
        break;
      case "checkbox":
        return (
          <div key={f.name} className="flex items-center gap-2 sm:col-span-2">
            <input
              {...common}
              type="checkbox"
              defaultChecked={Boolean(initial[f.name])}
              className="size-4"
            />
            <Label htmlFor={common.id}>{label(f.name)}</Label>
          </div>
        );
      case "select":
        control = (
          <NativeSelect
            {...common}
            defaultValue={str(initial[f.name]) || (f.allowEmpty ? "" : f.options[0])}
          >
            {f.allowEmpty ? <option value="">{t("record.chooseNone")}</option> : null}
            {f.options.map((o) => (
              <option key={o} value={o}>
                {enumLabel(f.labelPrefix, o)}
              </option>
            ))}
          </NativeSelect>
        );
        break;
      case "reference":
      case "member":
      case "stage": {
        const opts: Option[] =
          f.kind === "member"
            ? options.members
            : f.kind === "stage"
              ? options.stages
              : "collection" in f
                ? options[f.collection]
                : [];
        const fallback = f.kind === "stage" ? (opts[0]?.id ?? "") : "";
        control = (
          <NativeSelect {...common} defaultValue={str(initial[f.name]) || fallback}>
            {f.kind === "reference" ? <option value="">{t("record.chooseNone")}</option> : null}
            {f.kind === "member" && !initial[f.name] ? (
              <option value="">{t("record.choose")}</option>
            ) : null}
            {opts.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        );
        break;
      }
      case "tags":
        wide = true;
        control = (
          <>
            <TagInput
              id={common.id}
              value={tags}
              onChange={setTags}
              suggestions={options.tags}
              invalid={Boolean(err)}
              describedBy={[errId, `${f.name}-hint`].filter(Boolean).join(" ")}
            />
            <p id={`${f.name}-hint`} className="text-xs text-muted-foreground">
              {t("record.tagsHint")}
            </p>
          </>
        );
        break;
      case "related": {
        wide = true;
        const relatedOptions = {
          company: options.companies,
          contact: options.contacts,
          lead: options.leads,
          deal: options.deals,
        }[relatedType as (typeof RELATED_TYPES)[number]];
        const initialRelated = initial.related as { type: string; id: string } | null;
        return (
          <fieldset key={f.name} className="flex flex-col gap-2 sm:col-span-2" data-field={f.name}>
            <legend className="mb-1 text-sm font-medium">{label("related")}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="f-related-type">{label("relatedType")}</Label>
                <NativeSelect
                  id="f-related-type"
                  value={relatedType}
                  onChange={(e) => setRelatedType(e.target.value)}
                >
                  {RELATED_TYPES.map((r) => (
                    <option key={r} value={r}>
                      {enumLabel("relatedType", r)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="f-related-id">{label("relatedId")}</Label>
                <NativeSelect
                  id="f-related-id"
                  name="related.id"
                  key={relatedType}
                  defaultValue={initialRelated?.type === relatedType ? initialRelated.id : ""}
                  aria-invalid={err ? true : undefined}
                  aria-describedby={errId}
                >
                  <option value="">{t("record.chooseNone")}</option>
                  {relatedOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
            {err ? (
              <p id={errId} className="text-sm text-destructive">
                {err}
              </p>
            ) : null}
          </fieldset>
        );
      }
      case "address": {
        const address = (initial.address as Record<string, unknown> | undefined) ?? {};
        return (
          <fieldset key={f.name} className="flex flex-col gap-2 sm:col-span-2" data-field={f.name}>
            <legend className="mb-1 text-sm font-medium">{label("address")}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {ADDRESS_PARTS.map((p) => {
                const partErr = errors[`address.${p}`]?.join(" ");
                return (
                  <div key={p} className="flex flex-col gap-1.5">
                    <Label htmlFor={`f-address-${p}`}>{label(`address.${p}`)}</Label>
                    <Input
                      id={`f-address-${p}`}
                      name={`address.${p}`}
                      defaultValue={str(address[p])}
                      maxLength={p === "country" ? 2 : 120}
                      aria-invalid={partErr ? true : undefined}
                      aria-describedby={partErr ? `address-${p}-error` : undefined}
                    />
                    {partErr ? (
                      <p id={`address-${p}-error`} className="text-sm text-destructive">
                        {partErr}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </fieldset>
        );
      }
      case "phones":
        return (
          <fieldset key={f.name} className="flex flex-col gap-2 sm:col-span-2" data-field={f.name}>
            <legend className="mb-1 text-sm font-medium">{label("phones")}</legend>
            {phones.map((p, i) => {
              const phoneErr = errors[`phones.${i}.number`]?.join(" ");
              return (
                <div key={i} className="flex flex-wrap items-end gap-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`f-phone-label-${i}`}>{label("phoneLabel")}</Label>
                    <NativeSelect
                      id={`f-phone-label-${i}`}
                      value={p.label}
                      onChange={(e) =>
                        setPhones(
                          phones.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                        )
                      }
                    >
                      {PHONE_LABELS.map((l) => (
                        <option key={l} value={l}>
                          {enumLabel("phoneLabel", l)}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="flex min-w-48 flex-1 flex-col gap-1.5">
                    <Label htmlFor={`f-phone-${i}`}>{label("phone")}</Label>
                    <Input
                      id={`f-phone-${i}`}
                      type="tel"
                      value={p.number}
                      maxLength={32}
                      aria-invalid={phoneErr ? true : undefined}
                      onChange={(e) =>
                        setPhones(
                          phones.map((x, j) => (j === i ? { ...x, number: e.target.value } : x)),
                        )
                      }
                    />
                    {phoneErr ? <p className="text-sm text-destructive">{phoneErr}</p> : null}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={t("record.removePhone", { index: i + 1 })}
                    onClick={() => setPhones(phones.filter((_, j) => j !== i))}
                  >
                    ×
                  </Button>
                </div>
              );
            })}
            {phones.length < 3 ? (
              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPhones([...phones, { label: "work", number: "" }])}
                >
                  {t("record.addPhone")}
                </Button>
              </div>
            ) : null}
          </fieldset>
        );
    }
    return (
      <div key={f.name} className={`flex flex-col gap-1.5 ${wide ? "sm:col-span-2" : ""}`}>
        <Label htmlFor={common.id}>
          {label(f.name)}
          {"required" in f && f.required ? <span aria-hidden> *</span> : null}
        </Label>
        {control}
        {err ? (
          <p id={errId} className="text-sm text-destructive">
            {err}
          </p>
        ) : null}
        {(entity === "contacts" && f.name === "email") ||
        (entity === "companies" && f.name === "domain") ? (
          <p role="status" className="text-sm text-amber-700 dark:text-amber-400">
            {duplicate}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="flex max-w-3xl flex-col gap-6">
      {formError ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive"
        >
          {formError.text}{" "}
          {formError.conflict ? (
            <button type="button" className="underline" onClick={() => router.refresh()}>
              {t("record.reload")}
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">{fields.map(field)}</div>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? t("record.saving") : t("record.save")}
        </Button>
        <Button variant="outline" asChild>
          <Link href={cancelHref}>{t("common.cancel")}</Link>
        </Button>
      </div>
    </form>
  );
}
