import "server-only";
import { HEX_COLOR } from "@crm/shared/branding/theme";
import { interpolate } from "@crm/shared/branding/schemas";
import { t, type MessageKey } from "@crm/shared/i18n";
import type { MailTemplate } from "./mail";

// Branded transactional email rendering (FR-BRAND-003, requirements/05 §7). Every value —
// variables, app name, overrides — is HTML-escaped; tenants can change only the subject and the
// intro paragraph (plain text, allowlisted variables). Links come from server-built variables
// only. Colours are validated hex; images are absolute URLs on our own hosts.

export interface MailBrand {
  appName: string;
  primary: string;
  primaryFg: string;
  logoUrl: string | null;
  showPoweredBy: boolean;
}

export interface MailOverride {
  subject: string | null;
  intro: string | null;
}

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const safeUrl = (url: string | undefined | null) =>
  url && /^https?:\/\/[^\s"'<>]+$/.test(url) ? url : null;

const singleLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

export function renderMail(
  template: MailTemplate,
  variables: Record<string, string>,
  brand: MailBrand,
  override: MailOverride | null = null,
): RenderedMail {
  const vars = { ...variables, appName: brand.appName };
  const key = (part: string) => `mail.${template}.${part}` as MessageKey;
  const overrideValues = {
    "tenant.name": variables.name ?? variables.workspace ?? brand.appName,
    "user.firstName": variables.firstName ?? "",
    "inviter.name": variables.inviter ?? "",
  };
  const subject = singleLine(
    override?.subject ? interpolate(override.subject, overrideValues) : t(key("subject"), vars),
  );
  // Notifications share one template; wording follows the notification type.
  const notifKey = (part: "heading" | "intro") =>
    `notif.email.${variables.kind ?? "record_assigned"}.${part}` as MessageKey;
  const heading =
    template === "notification" ? t(notifKey("heading"), vars) : t(key("heading"), vars);
  const intro = override?.intro
    ? interpolate(override.intro, overrideValues)
    : template === "notification"
      ? t(notifKey("intro"), vars)
      : t(key("intro"), vars);
  const cta = t(key("cta"), vars);
  const link = safeUrl(variables.link);
  const primary = HEX_COLOR.test(brand.primary) ? brand.primary : "#171717";
  const primaryFg = HEX_COLOR.test(brand.primaryFg) ? brand.primaryFg : "#FFFFFF";
  const logo = safeUrl(brand.logoUrl);
  const footer =
    template === "demo_request_confirmation"
      ? t("mail.demo_request_confirmation.footer")
      : t("mail.footer", { appName: brand.appName });
  const unsubscribe = safeUrl(variables.unsubscribe);
  const unsubscribeHtml = unsubscribe
    ? ` · <a href="${escapeHtml(unsubscribe)}" style="color:#71717a">${escapeHtml(t("mail.unsubscribe"))}</a>`
    : "";

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:8px;padding:32px">
<tr><td style="padding-bottom:24px">${
    logo
      ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(brand.appName)}" height="40" style="height:40px;max-width:200px">`
      : `<strong style="font-size:18px">${escapeHtml(brand.appName)}</strong>`
  }</td></tr>
<tr><td><h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(heading)}</h1>
<p style="font-size:15px;line-height:22px;margin:0 0 24px">${escapeHtml(intro)}</p>${
    link && cta
      ? `
<p style="margin:0 0 24px"><a href="${escapeHtml(link)}" style="display:inline-block;background:${primary};color:${primaryFg};padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:bold">${escapeHtml(cta)}</a></p>
<p style="font-size:12px;color:#52525b;margin:0 0 8px">${escapeHtml(t("mail.linkFallback"))}</p>
<p style="font-size:12px;word-break:break-all;margin:0 0 24px"><a href="${escapeHtml(link)}" style="color:#52525b">${escapeHtml(link)}</a></p>`
      : ""
  }
<p style="font-size:12px;color:#71717a;margin:0">${escapeHtml(t("mail.ignore"))}</p></td></tr>
</table>
<p style="font-size:11px;color:#71717a;margin:16px 0 0">${escapeHtml(footer)}${
    brand.showPoweredBy ? ` · ${escapeHtml(t("mail.poweredBy"))}` : ""
  }${unsubscribeHtml}</p>
</td></tr></table></body></html>`;

  const text = [
    heading,
    "",
    intro,
    ...(link && cta ? ["", `${cta}: ${link}`] : []),
    "",
    t("mail.ignore"),
    "",
    footer + (brand.showPoweredBy ? ` · ${t("mail.poweredBy")}` : ""),
    ...(unsubscribe ? [`${t("mail.unsubscribe")}: ${unsubscribe}`] : []),
  ].join("\n");

  return { subject, html, text };
}

/** `"App Name" <address>` with the display name sanitised for the header. */
export function fromHeader(appName: string, address: string): string {
  const name =
    singleLine(appName)
      .replace(/["\\<>]/g, "")
      .slice(0, 60) || "CRM";
  return `"${name}" <${address}>`;
}
