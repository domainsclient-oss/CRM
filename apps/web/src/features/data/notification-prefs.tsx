"use client";

import { useState } from "react";
import { Button } from "@crm/ui/components/button";
import { toast } from "@crm/ui/lib/toast";
import { actionErrorMessage } from "@crm/shared/auth-messages";
import { t, type MessageKey } from "@crm/shared/i18n";
import { updateNotificationPrefsAction } from "./actions";

type Prefs = Record<string, { inApp: boolean; email: boolean }>;

/** Per-workspace notification preferences (FR-NOTF-002). */
export function NotificationPrefsForm({ initial }: { initial: Prefs }) {
  const [prefs, setPrefs] = useState(initial);
  const [pending, setPending] = useState(false);
  const toggle = (type: string, channel: "inApp" | "email") =>
    setPrefs({ ...prefs, [type]: { ...prefs[type]!, [channel]: !prefs[type]![channel] } });
  return (
    <section aria-labelledby="notif-prefs-heading" className="flex max-w-xl flex-col gap-3">
      <h2 id="notif-prefs-heading" className="text-lg font-medium">
        {t("notif.prefs.title")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("notif.prefs.body")}</p>
      <table className="text-sm">
        <thead className="text-left text-muted-foreground">
          <tr>
            <th scope="col" className="py-1 pe-4">
              <span className="sr-only">{t("notif.prefs.title")}</span>
            </th>
            <th scope="col" className="py-1 pe-4">
              {t("notif.prefs.inApp")}
            </th>
            <th scope="col" className="py-1">
              {t("notif.prefs.email")}
            </th>
          </tr>
        </thead>
        <tbody>
          {Object.keys(prefs).map((type) => {
            const event = t(`notif.type.${type}` as MessageKey);
            return (
              <tr key={type} className="border-t">
                <th scope="row" className="py-1 pe-4 text-left font-normal">
                  {event}
                </th>
                {(["inApp", "email"] as const).map((channel) => (
                  <td key={channel} className="py-1 pe-4">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={prefs[type]![channel]}
                      aria-label={t("notif.prefs.toggle", {
                        channel: t(channel === "inApp" ? "notif.prefs.inApp" : "notif.prefs.email"),
                        event,
                      })}
                      onChange={() => toggle(type, channel)}
                    />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div>
        <Button
          disabled={pending}
          onClick={async () => {
            setPending(true);
            const result = await updateNotificationPrefsAction({ prefs });
            setPending(false);
            if (!result.ok) return void toast.error(actionErrorMessage(result.error));
            toast.success(t("notif.prefs.saved"));
          }}
        >
          {t("record.save")}
        </Button>
      </div>
    </section>
  );
}
