import Link from "next/link";
import { FOOTER, NAV, PRODUCT } from "@crm/shared/content/marketing";
import { WebVitals } from "@/features/marketing/web-vitals";

// Public marketing site (FR-PUB-001). Statically generated; no tenant data, no third-party scripts.
export default function MarketingLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col">
      <WebVitals />
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="text-lg font-semibold">
            {PRODUCT}
          </Link>
          <nav aria-label="Site" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            {NAV.map(([href, label]) => (
              <Link
                key={href}
                href={href}
                className="inline-flex min-h-6 items-center hover:underline"
              >
                {label}
              </Link>
            ))}
            <Link
              href="/find-workspace"
              className="inline-flex min-h-8 items-center rounded-md border px-3 hover:bg-muted"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
        {children}
      </main>
      <footer className="border-t">
        <nav
          aria-label="Footer"
          className="mx-auto flex max-w-6xl flex-wrap gap-x-4 gap-y-2 px-4 py-6 text-sm"
        >
          {FOOTER.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className="inline-flex min-h-6 items-center text-muted-foreground hover:underline"
            >
              {label}
            </Link>
          ))}
        </nav>
      </footer>
    </div>
  );
}
