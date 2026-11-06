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
import { cancelSubscriptionAction, startCheckoutAction } from "./actions";

// Subscribe redirects to the gateway's hosted page (FR-BILL-002 AC1); the URL comes from our server,
// which only accepts the gateway's own domains.

export function SubscribeButton({
  planId,
  label,
}: {
  planId: "starter" | "growth" | "enterprise";
  label: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <Button
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          const result = await startCheckoutAction({ planId });
          if (!result.ok) {
            setPending(false);
            setError(actionErrorMessage(result.error));
            return;
          }
          window.location.assign((result.data as { url: string }).url);
        }}
      >
        {pending ? t("billing.redirecting") : label}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function CancelSubscriptionButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="self-start">
          {t("billing.cancel")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("billing.cancelTitle")}</DialogTitle>
          <DialogDescription>{t("billing.cancelBody")}</DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{t("common.close")}</Button>
          </DialogClose>
          <Button
            variant="destructive"
            onClick={async () => {
              const result = await cancelSubscriptionAction({});
              if (!result.ok) return setError(actionErrorMessage(result.error));
              setOpen(false);
              toast.success(t("billing.cancelled"));
              router.refresh();
            }}
          >
            {t("billing.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
