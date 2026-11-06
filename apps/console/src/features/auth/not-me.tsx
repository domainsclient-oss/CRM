import { Button } from "@crm/ui/components/button";
import { t } from "@crm/shared/i18n";
import { tokenSchema } from "@crm/shared/schemas/auth";
import { AuthCard } from "@/components/console-shell";

// "This wasn't me" confirmation (FR-AUTH-008 AC4). The emailed link only opens this page;
// revoking needs the POST below, so mail scanners and link prefetchers that follow the link
// can't consume the single-use token or sign the user out.
export async function NotMePage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string | string[] }>;
}) {
  const parsed = tokenSchema.safeParse((await searchParams).t);
  return (
    <AuthCard>
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">{t("console.notMe.title")}</h1>
        {parsed.success ? (
          <form method="post" action="/api/auth/not-me" className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">{t("console.notMe.body")}</p>
            <input type="hidden" name="t" value={parsed.data} />
            <Button type="submit" variant="destructive">
              {t("console.notMe.confirm")}
            </Button>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">{t("console.notMe.invalid")}</p>
        )}
      </div>
    </AuthCard>
  );
}
