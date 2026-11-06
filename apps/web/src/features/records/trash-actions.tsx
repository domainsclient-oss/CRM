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
import { toast } from "@crm/ui/lib/toast";
import { actionErrorMessage } from "@crm/shared/auth-messages";
import { t } from "@crm/shared/i18n";
import { purgeRecordAction, restoreRecordAction } from "./actions";
import type { RecordTypeName } from "./config";

export function TrashRowActions({
  type,
  id,
  name,
}: {
  type: RecordTypeName;
  id: string;
  name: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);

  async function run(fn: () => ReturnType<typeof restoreRecordAction>, success: string) {
    setPending(true);
    const result = await fn();
    setPending(false);
    if (!result.ok) {
      toast.error(actionErrorMessage(result.error));
      return;
    }
    toast.success(success);
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        aria-label={t("trash.restore", { name })}
        onClick={() => run(() => restoreRecordAction({ type, id }), t("trash.restored"))}
      >
        {t("trash.restoreButton")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant="destructive" aria-label={t("trash.purge", { name })}>
            {t("trash.purgeConfirm")}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("trash.purgeTitle", { name })}</DialogTitle>
            <DialogDescription>{t("trash.purgeBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{t("common.cancel")}</Button>
            </DialogClose>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => run(() => purgeRecordAction({ type, id }), t("trash.purged"))}
            >
              {t("trash.purgeConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
