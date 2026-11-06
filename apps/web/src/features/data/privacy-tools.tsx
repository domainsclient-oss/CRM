"use client";

import Link from "next/link";
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
import { Label } from "@crm/ui/components/label";
import { NativeSelect } from "@crm/ui/components/native-select";
import { toast } from "@crm/ui/lib/toast";
import { actionErrorMessage } from "@crm/shared/auth-messages";
import { t } from "@crm/shared/i18n";
import { eraseContactAction, exportContactDataAction } from "./actions";
import { download } from "./csv-button";

/** DSAR export + erasure for one contact (FR-PRIV-001/002). */
export function PrivacyTools({ contacts }: { contacts: Array<{ id: string; label: string }> }) {
  const router = useRouter();
  const [contactId, setContactId] = useState(contacts[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const name = contacts.find((c) => c.id === contactId)?.label ?? "";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex max-w-md flex-col gap-1.5">
        <Label htmlFor="dsar-contact">{t("privacy.contact")}</Label>
        <NativeSelect
          id="dsar-contact"
          value={contactId}
          onChange={(e) => setContactId(e.target.value)}
        >
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}{" "}
          {error === t("privacy.reauth") ? (
            <Link href="/login" className="underline">
              {t("console.reauth.link")}
            </Link>
          ) : null}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={!contactId}
          onClick={async () => {
            const result = await exportContactDataAction({ contactId });
            if (!result.ok) return setError(actionErrorMessage(result.error));
            const data = result.data as { json: string; csv: string };
            download(`contact-${contactId}.json`, data.json, "application/json");
            download(`contact-${contactId}.csv`, data.csv);
          }}
        >
          {t("privacy.export")}
        </Button>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="destructive" disabled={!contactId}>
              {t("privacy.erase")}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("privacy.eraseTitle", { name })}</DialogTitle>
              <DialogDescription>{t("privacy.eraseBody")}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">{t("common.cancel")}</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button
                  variant="destructive"
                  onClick={async () => {
                    const result = await eraseContactAction({ contactId });
                    if (!result.ok) {
                      return setError(
                        result.error.code === "REAUTH_REQUIRED"
                          ? t("privacy.reauth")
                          : actionErrorMessage(result.error),
                      );
                    }
                    toast.success(t("privacy.erased"));
                    router.refresh();
                  }}
                >
                  {t("privacy.erase")}
                </Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
