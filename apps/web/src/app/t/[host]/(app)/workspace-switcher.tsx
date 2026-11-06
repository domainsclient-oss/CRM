import type { WorkspaceSummary } from "@crm/core/services/workspaces";
import { t } from "@crm/shared/i18n";

// FR-TEN-008: switching goes to the other workspace's own host (sessions are host-only,
// so the user signs in there). Only active memberships are listed.
export function WorkspaceSwitcher({
  current,
  workspaces,
}: {
  current: string;
  workspaces: WorkspaceSummary[];
}) {
  const others = workspaces.filter((w) => w.tenantId !== current);
  if (others.length === 0) return null;
  return (
    <nav aria-label={t("app.switchWorkspace")}>
      <details className="relative">
        <summary className="cursor-pointer rounded-md px-3 py-1.5 text-sm hover:bg-muted">
          {t("app.workspaces")}
        </summary>
        <ul className="absolute right-0 z-10 mt-1 min-w-48 rounded-md border bg-popover p-1 shadow-md">
          {others.map((w) => (
            <li key={w.tenantId}>
              <a
                className="block rounded px-3 py-2 text-sm hover:bg-muted"
                href={`${w.host.includes("localhost") ? "http" : "https"}://${w.host}/`}
              >
                {w.name}
              </a>
            </li>
          ))}
        </ul>
      </details>
    </nav>
  );
}
