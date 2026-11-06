import type { Metadata } from "next";
import { verifyUnsubscribeToken } from "@crm/core/notifications";
import { t, type MessageKey } from "@crm/shared/i18n";
import { UnsubscribeButton } from "./unsubscribe-button";

export const metadata: Metadata = {
  title: t("unsubscribe.title"),
  robots: { index: false, follow: false },
};

// One-click unsubscribe from a notification type's emails (FR-NOTF-002). The signed token is the
// only proof needed; the page reveals nothing beyond the event type.
export default async function UnsubscribePage(props: PageProps<"/t/[host]/unsubscribe">) {
  const q = await props.searchParams;
  const token = typeof q.t === "string" ? q.t.slice(0, 512) : "";
  const parsed = token ? verifyUnsubscribeToken(token) : null;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t("unsubscribe.title")}</h1>
      {parsed ? (
        <>
          <p className="text-sm text-muted-foreground">
            {t("unsubscribe.body", { event: t(`notif.type.${parsed.type}` as MessageKey) })}
          </p>
          <UnsubscribeButton token={token} />
        </>
      ) : (
        <p role="alert" className="text-sm text-destructive">
          {t("unsubscribe.invalid")}
        </p>
      )}
    </div>
  );
}
