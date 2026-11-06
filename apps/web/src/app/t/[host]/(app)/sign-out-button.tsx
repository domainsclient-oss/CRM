"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@crm/ui/components/button";
import { signOutEverywhere } from "@crm/shared/auth-session";
import { t } from "@crm/shared/i18n";

/** FR-AUTH-006: signing out revokes sessions on every device. */
export function SignOutButton() {
  const [pending, setPending] = useState(false);
  const router = useRouter();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await signOutEverywhere();
        router.replace("/login");
        router.refresh();
      }}
    >
      {t("app.signOut")}
    </Button>
  );
}
