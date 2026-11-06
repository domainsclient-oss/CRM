"use client";

import { useState } from "react";
import { Button } from "@crm/ui/components/button";
import { actionErrorMessage } from "@crm/shared/auth-messages";
import { t } from "@crm/shared/i18n";
import { unsubscribeAction } from "@/features/data/actions";

export function UnsubscribeButton({ token }: { token: string }) {
  const [state, setState] = useState<"idle" | "done" | string>("idle");
  if (state === "done") return <p role="status">{t("unsubscribe.done")}</p>;
  return (
    <>
      <Button
        onClick={async () => {
          const result = await unsubscribeAction({ token });
          setState(result.ok ? "done" : actionErrorMessage(result.error));
        }}
      >
        {t("unsubscribe.confirm")}
      </Button>
      {state !== "idle" ? (
        <p role="alert" className="text-sm text-destructive">
          {state}
        </p>
      ) : null}
    </>
  );
}
