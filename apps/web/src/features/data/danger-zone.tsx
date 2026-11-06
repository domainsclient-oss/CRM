"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
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
import { toast } from "@crm/ui/lib/toast";
import { actionErrorMessage } from "@crm/shared/auth-messages";
import { t } from "@crm/shared/i18n";
import {
  cancelTenantDeletionAction,
  deleteAccountAction,
  exportTenantAction,
  requestTenantDeletionAction,
} from "./actions";

// Destructive / sensitive self-service actions (FR-TEN-006/007, FR-PRIV-003). All require a recent
// sign-in server-side; errors (e.g. REAUTH_REQUIRED, sole owner) are shown inline.

export function DeleteWorkspace({ slug }: { slug: string }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="destructive">{t("tenant.delete")}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("tenant.deleteTitle")}</DialogTitle>
          <DialogDescription>{t("tenant.deleteBody")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirm-slug">{t("tenant.deleteConfirmLabel", { slug })}</Label>
          <Input
            id="confirm-slug"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="off"
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{t("common.cancel")}</Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={pending || confirm !== slug}
            onClick={async () => {
              setPending(true);
              const result = await requestTenantDeletionAction({ confirmSlug: confirm });
              setPending(false);
              if (!result.ok) return setError(actionErrorMessage(result.error));
              router.refresh();
            }}
          >
            {t("tenant.deleteConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CancelDeletionButton() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        onClick={async () => {
          const result = await cancelTenantDeletionAction({});
          if (!result.ok) return setError(actionErrorMessage(result.error));
          toast.success(t("tenant.cancelled"));
          router.refresh();
        }}
      >
        {t("tenant.cancel")}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </>
  );
}

export function TenantExportButton() {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="outline"
        className="self-start"
        onClick={async () => {
          const result = await exportTenantAction({});
          if (!result.ok) return setError(actionErrorMessage(result.error));
          toast.success(t("export.started"));
        }}
      >
        {t("export.tenant")}
      </Button>
      <p className="text-xs text-muted-foreground">{t("export.tenantBody")}</p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function DeleteAccount() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="destructive" className="self-start">
          {t("account.delete")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("account.deleteTitle")}</DialogTitle>
          <DialogDescription>{t("account.deleteBody")}</DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{t("common.cancel")}</Button>
          </DialogClose>
          <Button
            variant="destructive"
            onClick={async () => {
              const result = await deleteAccountAction({});
              if (!result.ok) {
                return setError(
                  result.error.code === "CONFLICT"
                    ? t("account.soleOwner")
                    : actionErrorMessage(result.error),
                );
              }
              toast.success(t("account.deleted"));
              router.replace("/login");
              router.refresh();
            }}
          >
            {t("account.deleteConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
