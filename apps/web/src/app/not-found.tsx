import Link from "next/link";
import { Button } from "@crm/ui/components/button";
import { t } from "@crm/shared/i18n";

// Neutral 404: never reveals whether a workspace or record exists (requirements/01 FR-TEN-004).
export default function NotFound() {
  return (
    <main
      id="main"
      className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-16 text-center"
    >
      <h1 className="text-2xl font-semibold">{t("page.notFound.title")}</h1>
      <p className="text-muted-foreground">{t("page.notFound.body")}</p>
      <Button asChild variant="outline">
        <Link href="/">{t("common.backHome")}</Link>
      </Button>
    </main>
  );
}
