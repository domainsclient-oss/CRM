"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@crm/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@crm/ui/components/dialog";
import { Input } from "@crm/ui/components/input";
import { Label } from "@crm/ui/components/label";
import { NativeSelect } from "@crm/ui/components/native-select";
import { Textarea } from "@crm/ui/components/textarea";
import { toast } from "@crm/ui/lib/toast";
import { actionErrorMessage } from "@crm/shared/auth-messages";
import type { ActionResult } from "@crm/shared/errors";
import { t } from "@crm/shared/i18n";
import { LOST_REASONS } from "@crm/shared/records/schemas";
import {
  closeDealAction,
  convertLeadAction,
  deleteRecordAction,
  reassignRecordAction,
  reopenDealAction,
  setTaskDoneAction,
} from "./actions";
import { enumLabel, type RecordTypeName } from "./config";

// Record-level controls. Every action is re-authorized on the server; these only offer what the
// actor's role allows.

type Option = { id: string; label: string };

function useAction() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run<T>(
    fn: () => Promise<ActionResult<T>>,
    success: string,
    after?: (d: T) => void,
  ) {
    setPending(true);
    setError(null);
    const result = await fn();
    setPending(false);
    if (!result.ok) {
      setError(actionErrorMessage(result.error));
      return false;
    }
    toast.success(success);
    if (after) after(result.data);
    else router.refresh();
    return true;
  }
  return { pending, error, run, router };
}

function ErrorText({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  ) : null;
}

function ConfirmDialog({
  trigger,
  title,
  body,
  confirm,
  destructive,
  children,
  onConfirm,
  pending,
  error,
}: {
  trigger: ReactNode;
  title: string;
  body?: string;
  confirm: string;
  destructive?: boolean;
  children?: ReactNode;
  onConfirm: () => Promise<boolean>;
  pending: boolean;
  error: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {body ? <DialogDescription>{body}</DialogDescription> : null}
        </DialogHeader>
        {children}
        <ErrorText error={error} />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{t("common.cancel")}</Button>
          </DialogClose>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={pending}
            onClick={async () => {
              if (await onConfirm()) setOpen(false);
            }}
          >
            {confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteRecordButton({
  type,
  id,
  name,
  listHref,
}: {
  type: RecordTypeName;
  id: string;
  name: string;
  listHref: string;
}) {
  const action = useAction();
  return (
    <ConfirmDialog
      trigger={<Button variant="destructive">{t("record.delete")}</Button>}
      title={t("record.deleteTitle", { name })}
      body={t("record.deleteBody")}
      confirm={t("record.delete")}
      destructive
      pending={action.pending}
      error={action.error}
      onConfirm={() =>
        action.run(
          () => deleteRecordAction({ type, id }),
          t("record.deleted"),
          () => {
            action.router.push(listHref);
            action.router.refresh();
          },
        )
      }
    />
  );
}

export function ReassignButton({
  type,
  id,
  name,
  current,
  members,
}: {
  type: RecordTypeName;
  id: string;
  name: string;
  current: string;
  members: Option[];
}) {
  const action = useAction();
  const [owner, setOwner] = useState(current);
  return (
    <ConfirmDialog
      trigger={<Button variant="outline">{t("record.reassign")}</Button>}
      title={t("record.reassignTitle", { name })}
      confirm={t("record.save")}
      pending={action.pending}
      error={action.error}
      onConfirm={() =>
        action.run(
          () => reassignRecordAction({ type, id, ownerUid: owner }),
          t("record.reassigned"),
        )
      }
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reassign-owner">{t("field.ownerUid")}</Label>
        <NativeSelect id="reassign-owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </NativeSelect>
      </div>
    </ConfirmDialog>
  );
}

export function ConvertLeadButton({
  leadId,
  name,
  companyName,
  matches,
  currencyHint,
}: {
  leadId: string;
  name: string;
  companyName: string | null;
  matches: { contact: Option | null; company: Option | null };
  currencyHint: string;
}) {
  const action = useAction();
  const [open, setOpen] = useState(false);
  const [withDeal, setWithDeal] = useState(true);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const companyChoice = String(data.get("company"));
    const ok = await action.run(
      () =>
        convertLeadAction({
          leadId,
          contactId: data.get("contact") === "new" ? null : String(data.get("contact")),
          company:
            companyChoice === "new"
              ? { mode: "new" }
              : companyChoice === "none"
                ? { mode: "none" }
                : { mode: "existing", id: companyChoice },
          deal: withDeal
            ? {
                name: String(data.get("dealName") ?? ""),
                amount: String(data.get("dealAmount") ?? ""),
              }
            : null,
        }),
      t("lead.converted"),
      (result) => {
        action.router.push(`/contacts/${result.contactId}`);
        action.router.refresh();
      },
    );
    if (ok) setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>{t("lead.convert")}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("lead.convertTitle", { name })}</DialogTitle>
          <DialogDescription>{t("lead.convertBody")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="convert-contact">{t("lead.convert.contact")}</Label>
            <NativeSelect
              id="convert-contact"
              name="contact"
              defaultValue={matches.contact?.id ?? "new"}
            >
              <option value="new">{t("lead.convert.contactNew")}</option>
              {matches.contact ? (
                <option value={matches.contact.id}>
                  {t("lead.convert.contactMatch", { name: matches.contact.label })}
                </option>
              ) : null}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="convert-company">{t("lead.convert.company")}</Label>
            <NativeSelect
              id="convert-company"
              name="company"
              defaultValue={matches.company?.id ?? (companyName ? "new" : "none")}
            >
              <option value="none">{t("lead.convert.companyNone")}</option>
              {companyName ? (
                <option value="new">{t("lead.convert.companyNew", { name: companyName })}</option>
              ) : null}
              {matches.company ? (
                <option value={matches.company.id}>
                  {t("lead.convert.companyMatch", { name: matches.company.label })}
                </option>
              ) : null}
            </NativeSelect>
          </div>
          <div className="flex items-center gap-2">
            <input
              id="convert-deal"
              type="checkbox"
              className="size-4"
              checked={withDeal}
              onChange={(e) => setWithDeal(e.target.checked)}
            />
            <Label htmlFor="convert-deal">{t("lead.convert.deal")}</Label>
          </div>
          {withDeal ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="convert-deal-name">{t("lead.convert.dealName")}</Label>
                <Input
                  id="convert-deal-name"
                  name="dealName"
                  defaultValue={companyName ? `${companyName} deal` : `${name} deal`}
                  maxLength={120}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="convert-deal-amount">
                  {t("lead.convert.dealAmount")} ({currencyHint})
                </Label>
                <Input
                  id="convert-deal-amount"
                  name="dealAmount"
                  inputMode="decimal"
                  maxLength={20}
                />
              </div>
            </div>
          ) : null}
          <ErrorText error={action.error} />
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" type="button">
                {t("common.cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={action.pending}>
              {t("lead.convert.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DealCloseButtons({
  id,
  name,
  hasContact,
}: {
  id: string;
  name: string;
  hasContact: boolean;
}) {
  const won = useAction();
  const lost = useAction();
  const [markCustomer, setMarkCustomer] = useState(true);
  const [reason, setReason] = useState<string>(LOST_REASONS[0]);
  const [details, setDetails] = useState("");
  return (
    <>
      <ConfirmDialog
        trigger={<Button>{t("deal.markWon")}</Button>}
        title={t("deal.wonTitle", { name })}
        confirm={t("deal.markWon")}
        pending={won.pending}
        error={won.error}
        onConfirm={() =>
          won.run(
            () =>
              closeDealAction({
                id,
                outcome: { outcome: "won", markContactCustomer: hasContact && markCustomer },
              }),
            t("deal.won"),
          )
        }
      >
        {hasContact ? (
          <div className="flex items-center gap-2">
            <input
              id="won-customer"
              type="checkbox"
              className="size-4"
              checked={markCustomer}
              onChange={(e) => setMarkCustomer(e.target.checked)}
            />
            <Label htmlFor="won-customer">{t("deal.markCustomer")}</Label>
          </div>
        ) : null}
      </ConfirmDialog>
      <ConfirmDialog
        trigger={<Button variant="outline">{t("deal.markLost")}</Button>}
        title={t("deal.lostTitle", { name })}
        confirm={t("deal.markLost")}
        pending={lost.pending}
        error={lost.error}
        onConfirm={() =>
          lost.run(
            () =>
              closeDealAction({
                id,
                outcome: { outcome: "lost", lostReason: reason, lostReasonText: details },
              }),
            t("deal.lost"),
          )
        }
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lost-reason">{t("field.lostReason")}</Label>
            <NativeSelect
              id="lost-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            >
              {LOST_REASONS.map((r) => (
                <option key={r} value={r}>
                  {enumLabel("lostReason", r)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lost-details">{t("field.lostReasonText")}</Label>
            <Textarea
              id="lost-details"
              value={details}
              maxLength={500}
              onChange={(e) => setDetails(e.target.value)}
            />
          </div>
        </div>
      </ConfirmDialog>
    </>
  );
}

export function ReopenDealButton({
  id,
  name,
  stages,
}: {
  id: string;
  name: string;
  stages: Option[];
}) {
  const action = useAction();
  const [stage, setStage] = useState(stages[0]?.id ?? "");
  return (
    <ConfirmDialog
      trigger={<Button variant="outline">{t("deal.reopen")}</Button>}
      title={t("deal.reopenTitle", { name })}
      confirm={t("deal.reopen")}
      pending={action.pending}
      error={action.error}
      onConfirm={() =>
        action.run(() => reopenDealAction({ id, stageId: stage }), t("deal.reopened"))
      }
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reopen-stage">{t("field.stageId")}</Label>
        <NativeSelect id="reopen-stage" value={stage} onChange={(e) => setStage(e.target.value)}>
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </NativeSelect>
      </div>
    </ConfirmDialog>
  );
}

export function TaskDoneToggle({ id, title, done }: { id: string; title: string; done: boolean }) {
  const action = useAction();
  const [checked, setChecked] = useState(done); // optimistic; reverts if the server refuses
  return (
    <span className="inline-flex items-center gap-2">
      <input
        type="checkbox"
        className="size-5"
        checked={checked}
        disabled={action.pending}
        aria-label={done ? t("task.reopen", { title }) : t("task.complete", { title })}
        onChange={async () => {
          setChecked(!done);
          const result = await setTaskDoneAction({ id, done: !done });
          if (!result.ok) {
            setChecked(done);
            toast.error(actionErrorMessage(result.error));
            return;
          }
          toast.success(done ? t("task.reopened") : t("task.completed"), {
            action: {
              label: t("task.undo"),
              onClick: async () => {
                const undo = await setTaskDoneAction({ id, done });
                if (undo.ok) action.router.refresh();
              },
            },
          });
          action.router.refresh();
        }}
      />
      {action.error ? (
        <span role="alert" className="text-sm text-destructive">
          {action.error}
        </span>
      ) : null}
    </span>
  );
}
