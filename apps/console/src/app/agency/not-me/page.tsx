import type { Metadata } from "next";
import { t } from "@crm/shared/i18n";
import { NotMePage } from "@/features/auth/not-me";

export const metadata: Metadata = {
  title: t("console.notMe.title"),
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function Page({ searchParams }: PageProps<"/agency/not-me">) {
  return <NotMePage searchParams={searchParams} />;
}
