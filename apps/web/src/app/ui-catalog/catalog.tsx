"use client";

import { toast } from "@crm/ui/lib/toast";
import { Button } from "@crm/ui/components/button";
import { Input } from "@crm/ui/components/input";
import { Label } from "@crm/ui/components/label";
import { Skeleton } from "@crm/ui/components/skeleton";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@crm/ui/components/dialog";
import { t } from "@crm/shared/i18n";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby={`section-${title}`}>
      <h2 id={`section-${title}`} className="text-lg font-medium">
        {title}
      </h2>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </section>
  );
}

export function Catalog() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-4 py-10">
      <h1 className="text-2xl font-semibold">{t("uiCatalog.title")}</h1>

      <Section title="Buttons">
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="destructive">Destructive</Button>
        <Button disabled>Disabled</Button>
      </Section>

      <Section title="Form field">
        <div className="flex w-full max-w-sm flex-col gap-2">
          <Label htmlFor="catalog-email">Email</Label>
          <Input
            id="catalog-email"
            type="email"
            autoComplete="email"
            placeholder="name@example.com"
          />
        </div>
      </Section>

      <Section title="Dialog">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline">Open dialog</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Example dialog</DialogTitle>
              <DialogDescription>
                Focus is trapped here and returns to the trigger on close.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">{t("common.cancel")}</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button>{t("common.save")}</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Section>

      <Section title="Toast">
        <Button variant="outline" onClick={() => toast.success(t("uiCatalog.toastMessage"))}>
          Show toast
        </Button>
      </Section>

      <Section title="Skeleton">
        <div
          className="flex w-full max-w-sm flex-col gap-2"
          aria-busy="true"
          aria-label={t("common.loading")}
        >
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </Section>
    </div>
  );
}
