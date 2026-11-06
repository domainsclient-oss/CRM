"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
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
import { actionErrorMessage } from "@crm/shared/auth-messages";
import type { ActionResult } from "@crm/shared/errors";
import { t, type MessageKey } from "@crm/shared/i18n";
import { assignableRoles, invitableRoles, type WorkspaceRole } from "@crm/shared/permissions";
import {
  changeRoleAction,
  forceSignOutAction,
  inviteMemberAction,
  removeMemberAction,
  resendInvitationAction,
  revokeInvitationAction,
  transferOwnershipAction,
} from "@/features/members/actions";

// Team management UI (T-03-05). Menus mirror the server rules via @crm/shared/permissions,
// but every action is re-authorized on the server.

interface Member {
  uid: string;
  displayName: string;
  email: string;
  role: WorkspaceRole;
}
interface Invitation {
  id: string;
  email: string;
  role: WorkspaceRole;
  expiresAt: string;
  resendCount: number;
}
interface Props {
  me: { uid: string; role: WorkspaceRole };
  members: Member[];
  invitations: Invitation[];
  permissions: {
    invite: boolean;
    update: boolean;
    remove: boolean;
    forceSignOut: boolean;
    transfer: boolean;
  };
}

const roleLabel = (role: WorkspaceRole) => t(`team.role.${role}` as MessageKey);
const selectClass = "h-9 rounded-md border bg-background px-2 text-sm";

function useFeedback() {
  const router = useRouter();
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  async function run<T>(fn: () => Promise<ActionResult<T>>, success: (data: T) => string) {
    setPending(true);
    const result = await fn();
    setPending(false);
    if (result.ok) {
      setMessage({ kind: "ok", text: success(result.data) });
      router.refresh();
    } else {
      setMessage({ kind: "error", text: actionErrorMessage(result.error) });
    }
    return result.ok;
  }
  return { message, pending, run };
}

export function TeamManager({ me, members, invitations, permissions }: Props) {
  const feedback = useFeedback();
  const inviteOptions = invitableRoles(me.role);
  const heirs = members.filter((m) => m.role !== "viewer");

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <h1 className="text-2xl font-semibold">{t("team.title")}</h1>

      {feedback.message ? (
        <p
          role={feedback.message.kind === "error" ? "alert" : "status"}
          className={feedback.message.kind === "error" ? "text-sm text-destructive" : "text-sm"}
        >
          {feedback.message.text}
        </p>
      ) : null}

      {permissions.invite && inviteOptions.length > 0 ? (
        <InviteForm roles={inviteOptions} feedback={feedback} />
      ) : null}

      <section aria-labelledby="members-heading" className="flex flex-col gap-3">
        <h2 id="members-heading" className="text-lg font-medium">
          {t("team.members")}
        </h2>
        <div
          className="overflow-x-auto rounded-xl border"
          tabIndex={0}
          role="region"
          aria-label={t("team.membersList")}
        >
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th scope="col" className="px-3 py-2">
                  {t("team.col.name")}
                </th>
                <th scope="col" className="px-3 py-2">
                  {t("team.col.email")}
                </th>
                <th scope="col" className="px-3 py-2">
                  {t("team.col.role")}
                </th>
                <th scope="col" className="px-3 py-2">
                  {t("team.col.actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const isMe = m.uid === me.uid;
                const roles = isMe || !permissions.update ? [] : assignableRoles(me.role, m.role);
                const canManage =
                  !isMe && m.role !== "owner" && !(me.role === "admin" && m.role === "admin");
                return (
                  <tr key={m.uid} className="border-t align-top">
                    <th scope="row" className="px-3 py-2 text-left font-medium">
                      {m.displayName}{" "}
                      {isMe ? <span className="text-muted-foreground">{t("team.you")}</span> : null}
                    </th>
                    <td className="px-3 py-2 break-all">{m.email}</td>
                    <td className="px-3 py-2">
                      {roles.length > 0 ? (
                        <select
                          aria-label={t("team.roleFor", { name: m.displayName })}
                          className={selectClass}
                          defaultValue={m.role}
                          disabled={feedback.pending}
                          onChange={async (e) => {
                            const select = e.currentTarget;
                            const ok = await feedback.run(
                              () => changeRoleAction({ uid: m.uid, role: select.value }),
                              () => t("team.roleChanged"),
                            );
                            if (!ok) select.value = m.role; // show the role that's actually in effect
                          }}
                        >
                          {[m.role, ...roles.filter((r) => r !== m.role)].map((r) => (
                            <option key={r} value={r}>
                              {roleLabel(r)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        roleLabel(m.role)
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        {permissions.forceSignOut && canManage ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={feedback.pending}
                            aria-label={`${t("team.signOut")}: ${m.displayName}`}
                            onClick={() =>
                              feedback.run(
                                () => forceSignOutAction({ uid: m.uid }),
                                () => t("team.signedOut", { name: m.displayName }),
                              )
                            }
                          >
                            {t("team.signOut")}
                          </Button>
                        ) : null}
                        {permissions.remove && canManage ? (
                          <RemoveDialog
                            member={m}
                            heirs={heirs.filter((h) => h.uid !== m.uid)}
                            feedback={feedback}
                          />
                        ) : null}
                        {permissions.transfer && m.role === "admin" ? (
                          <TransferDialog member={m} feedback={feedback} />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!permissions.invite && !permissions.update ? (
          <p className="text-sm text-muted-foreground">{t("team.readOnly")}</p>
        ) : null}
      </section>

      {permissions.invite && invitations.length > 0 ? (
        <section aria-labelledby="pending-heading" className="flex flex-col gap-3">
          <h2 id="pending-heading" className="text-lg font-medium">
            {t("team.pending")}
          </h2>
          <div
            className="overflow-x-auto rounded-xl border"
            tabIndex={0}
            role="region"
            aria-label={t("team.pendingList")}
          >
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th scope="col" className="px-3 py-2">
                    {t("team.col.email")}
                  </th>
                  <th scope="col" className="px-3 py-2">
                    {t("team.col.role")}
                  </th>
                  <th scope="col" className="px-3 py-2">
                    {t("team.col.expires")}
                  </th>
                  <th scope="col" className="px-3 py-2">
                    {t("team.col.actions")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((inv) => (
                  <tr key={inv.id} className="border-t">
                    <th scope="row" className="px-3 py-2 text-left font-medium break-all">
                      {inv.email}
                    </th>
                    <td className="px-3 py-2">{roleLabel(inv.role)}</td>
                    <td className="px-3 py-2">
                      <time dateTime={inv.expiresAt}>
                        {new Date(inv.expiresAt).toLocaleDateString()}
                      </time>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={feedback.pending || inv.resendCount >= 3}
                          aria-label={`${t("team.resend")}: ${inv.email}`}
                          onClick={() =>
                            feedback.run(
                              () => resendInvitationAction({ invitationId: inv.id }),
                              () => t("team.resent"),
                            )
                          }
                        >
                          {t("team.resend")}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={feedback.pending}
                          aria-label={`${t("team.revoke")}: ${inv.email}`}
                          onClick={() =>
                            feedback.run(
                              () => revokeInvitationAction({ invitationId: inv.id }),
                              () => t("team.revoked"),
                            )
                          }
                        >
                          {t("team.revoke")}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

type Feedback = ReturnType<typeof useFeedback>;

function InviteForm({ roles, feedback }: { roles: WorkspaceRole[]; feedback: Feedback }) {
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const ok = await feedback.run(
      () => inviteMemberAction({ email: data.get("email"), role: data.get("role") }),
      (d) => t("team.invite.sent", { email: d.email }),
    );
    if (ok) form.reset();
  }
  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-end"
      noValidate
    >
      <h2 className="sr-only">{t("team.invite.title")}</h2>
      <div className="flex flex-1 flex-col gap-2">
        <Label htmlFor="invite-email">{t("team.invite.email")}</Label>
        <Input id="invite-email" name="email" type="email" autoComplete="off" required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="invite-role">{t("team.invite.role")}</Label>
        <select
          id="invite-role"
          name="role"
          className={selectClass}
          defaultValue={roles.includes("member") ? "member" : roles[0]}
        >
          {roles.map((r) => (
            <option key={r} value={r}>
              {roleLabel(r)}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" disabled={feedback.pending}>
        {t("team.invite.submit")}
      </Button>
    </form>
  );
}

function RemoveDialog({
  member,
  heirs,
  feedback,
}: {
  member: Member;
  heirs: Member[];
  feedback: Feedback;
}) {
  const [open, setOpen] = useState(false);
  const [heir, setHeir] = useState(heirs[0]?.uid ?? "");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="destructive"
          aria-label={`${t("team.remove")}: ${member.displayName}`}
        >
          {t("team.remove")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("team.remove.title", { name: member.displayName })}</DialogTitle>
          <DialogDescription>{t("team.remove.body")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`heir-${member.uid}`}>{t("team.remove.reassignTo")}</Label>
          <select
            id={`heir-${member.uid}`}
            className={selectClass}
            value={heir}
            onChange={(e) => setHeir(e.target.value)}
          >
            {heirs.map((h) => (
              <option key={h.uid} value={h.uid}>
                {h.displayName}
              </option>
            ))}
          </select>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{t("common.cancel")}</Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={feedback.pending || !heir}
            onClick={async () => {
              const ok = await feedback.run(
                () => removeMemberAction({ uid: member.uid, reassignTo: heir }),
                (d) => t("team.removed", { name: member.displayName, count: d.recordsReassigned }),
              );
              if (ok) setOpen(false);
            }}
          >
            {t("team.remove.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TransferDialog({ member, feedback }: { member: Member; feedback: Feedback }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          aria-label={`${t("team.transfer")}: ${member.displayName}`}
        >
          {t("team.transfer")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("team.transfer.title", { name: member.displayName })}</DialogTitle>
          <DialogDescription>{t("team.transfer.body")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{t("common.cancel")}</Button>
          </DialogClose>
          <Button
            disabled={feedback.pending}
            onClick={async () => {
              const ok = await feedback.run(
                () => transferOwnershipAction({ toUid: member.uid }),
                () => t("team.transferred"),
              );
              if (ok) setOpen(false);
            }}
          >
            {t("team.transfer.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
