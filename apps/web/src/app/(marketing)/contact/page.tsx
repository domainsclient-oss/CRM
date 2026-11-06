import { CONTACT_FORM, PAGES } from "@crm/shared/content/marketing";
import { pageMetadata } from "@/features/marketing/seo";
import { ContactForm } from "@/features/marketing/contact-form";

export const metadata = pageMetadata(PAGES.contact);

export default function ContactPage() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex max-w-2xl flex-col gap-2">
        <h1 className="text-3xl font-semibold">{CONTACT_FORM.heading}</h1>
        <p className="text-lg text-muted-foreground">{CONTACT_FORM.intro}</p>
      </header>
      <ContactForm />
    </div>
  );
}
