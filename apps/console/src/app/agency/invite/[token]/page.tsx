import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Skeleton } from "@crm/ui/components/skeleton";
import { AppError } from "@crm/core/errors";
import { viewInvitation } from "@crm/core/services/invitations";
import { tokenSchema } from "@crm/shared/schemas/auth";
import { t } from "@crm/shared/i18n";
import { nextRequestSource } from "@/server/request";
import { AuthCard } from "@/components/console-shell";
import { AcceptForm } from "./accept-form";

export const metadata: Metadata = {
  title: t("invite.title"),
  robots: { index: false, follow: false },
  // The URL contains a single-use secret: never leak it in Referer headers.
  referrer: "no-referrer",
};

export default function InvitePage({ params }: PageProps<"/agency/invite/[token]">) {
  return (
    <AuthCard>
      <Suspense fallback={<Skeleton className="h-72 w-full" aria-label={t("common.loading")} />}>
        <InviteContent params={params} />
      </Suspense>
    </AuthCard>
  );
}

async function InviteContent({ params }: { params: Promise<{ token: string }> }) {
  await connection(); // request-time only (token lookup, clock checks)
  const { token } = await params;
  const parsed = tokenSchema.safeParse(token);
  const req = await nextRequestSource();
  const view = parsed.success
    ? await viewInvitation(parsed.data, req.host).catch((error: unknown) => {
        if (error instanceof AppError && error.code === "NOT_FOUND") return null;
        throw error;
      })
    : null;

  if (!view || view.kind !== "agency") {
    return (
      <div className="flex flex-col gap-3" role="status">
        <h1 className="text-xl font-semibold">{t("invite.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("invite.invalid")}</p>
      </div>
    );
  }
  return (
    <AcceptForm
      token={parsed.data!}
      email={view.email}
      role={view.role}
      accountExists={view.accountExists}
    />
  );
}
