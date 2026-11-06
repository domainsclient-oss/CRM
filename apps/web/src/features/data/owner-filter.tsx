"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Label } from "@crm/ui/components/label";
import { NativeSelect } from "@crm/ui/components/native-select";
import { t } from "@crm/shared/i18n";

/** Owner filter for workspace-wide roles (FR-DASH-002); state lives in the URL. */
export function OwnerFilter({
  members,
  current,
}: {
  members: Record<string, string>;
  current: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="owner-filter">{t("dash.owner")}</Label>
      <NativeSelect
        id="owner-filter"
        value={current ?? ""}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          if (e.target.value) next.set("owner", e.target.value);
          else next.delete("owner");
          router.push(`${pathname}${next.size ? `?${next}` : ""}`);
        }}
      >
        <option value="">{t("dash.allOwners")}</option>
        {Object.entries(members).map(([uid, name]) => (
          <option key={uid} value={uid}>
            {name}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
