import "server-only";
import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import {
  brandAssetUrl,
  getBrandingForTenant,
  resolveBranding,
  PLATFORM_BRANDING,
} from "./branding/resolve";
import { resolveEffectiveConfig } from "./config/entitlements";
import { loadAgencyDoc, loadTenantDoc } from "./contexts/tenant-context";
import { AppError } from "./errors";
import { getDb } from "./firebase-admin";
import { logger } from "./logger";
import type { MailMessage } from "./mail";
import { fromHeader, renderMail, type MailBrand, type MailOverride } from "./mail-render";
import { deriveTheme } from "@crm/shared/branding/theme";
import { getServerEnv } from "./server-env";
import { hostUrl } from "./urls";

// Outbox delivery (ADR-012, FR-BRAND-003): render each queued message with the resolved branding
// of its workspace/agency and hand it to the configured provider. Console is for local use;
// hosted delivery uses Resend with its API key bound to the mail Cloud Function.

export interface OutgoingMail {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface MailProvider {
  name: string;
  send(mail: OutgoingMail): Promise<{ id: string }>;
}

const consoleProvider: MailProvider = {
  name: "console",
  async send(mail) {
    // Never logs the recipient or the body; the subject carries no PII.
    logger.info("mail.console_send", { subject: mail.subject });
    return { id: `console_${randomUUID()}` };
  },
};

export function createResendProvider(apiKey: string): MailProvider {
  return {
    name: "resend",
    async send(mail) {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(mail),
      });
      if (!response.ok) {
        throw new AppError(
          "INTERNAL",
          `email_provider_request_failed:resend_status_${response.status}`,
        );
      }
      const result: unknown = await response.json();
      if (
        typeof result !== "object" ||
        result === null ||
        !("id" in result) ||
        typeof result.id !== "string" ||
        result.id.length === 0
      ) {
        throw new AppError("INTERNAL", "email_provider_invalid_response:resend");
      }
      return { id: result.id };
    },
  };
}

let override: MailProvider | undefined;
/** Test hook. */
export function setMailProvider(next: MailProvider | undefined): void {
  override = next;
}

export function getMailProvider(): MailProvider {
  if (override) return override;
  const provider = getServerEnv().EMAIL_PROVIDER;
  if (provider === "console") return consoleProvider;
  if (provider === "resend") {
    const apiKey = getServerEnv().EMAIL_PROVIDER_API_KEY;
    if (!apiKey) throw new AppError("INTERNAL", "email_provider_api_key_not_configured");
    return createResendProvider(apiKey);
  }
  throw new AppError("INTERNAL", `email_provider_not_configured:${provider}`);
}

function platformBrand(): MailBrand {
  const theme = deriveTheme(PLATFORM_BRANDING.primaryColor, PLATFORM_BRANDING.accentColor);
  return {
    appName: PLATFORM_BRANDING.appName,
    primary: theme.ok ? theme.theme.primary : "#171717",
    primaryFg: theme.ok ? theme.theme.primaryFg : "#FFFFFF",
    logoUrl: null,
    showPoweredBy: true,
  };
}

/** Branding + overrides for one message. Exported for previews. */
export async function brandForMessage(
  message: Pick<MailMessage, "tenantId" | "agencyId" | "template">,
): Promise<{ brand: MailBrand; override: MailOverride | null }> {
  if (message.tenantId) {
    const [tenant, branding] = await Promise.all([
      loadTenantDoc(message.tenantId),
      getBrandingForTenant(message.tenantId),
    ]);
    if (tenant && branding) {
      const agency = await loadAgencyDoc(tenant.agencyId);
      const config = resolveEffectiveConfig(tenant, agency);
      const path = brandAssetUrl(branding.logoLightPath);
      const db = getDb();
      const [own, agencyDefault] = await Promise.all([
        db.doc(`tenants/${message.tenantId}/emailTemplates/${message.template}`).get(),
        db.doc(`agencies/${tenant.agencyId}/emailTemplates/${message.template}`).get(),
      ]);
      const pickText = (field: "subject" | "intro") =>
        (own.get(field) as string | null | undefined) ??
        (agencyDefault.get(field) as string | null | undefined) ??
        null;
      return {
        brand: {
          appName: branding.appName,
          primary: branding.theme.primary,
          primaryFg: branding.theme.primaryFg,
          logoUrl: path ? hostUrl(tenant.canonicalHost, path) : null,
          showPoweredBy: config.showPoweredBy,
        },
        override: { subject: pickText("subject"), intro: pickText("intro") },
      };
    }
  }
  if (message.agencyId) {
    const agency = await loadAgencyDoc(message.agencyId);
    if (agency) {
      const branding = resolveBranding(agency, null);
      const partners = getServerEnv().APP_PARTNERS_HOST;
      const path = brandAssetUrl(branding.logoLightPath);
      return {
        brand: {
          appName: branding.appName,
          primary: branding.theme.primary,
          primaryFg: branding.theme.primaryFg,
          logoUrl: path && partners ? hostUrl(partners, path) : null,
          showPoweredBy: true,
        },
        override: null,
      };
    }
  }
  return { brand: platformBrand(), override: null };
}

const MAX_ATTEMPTS = 5;

/**
 * Deliver queued messages (Cloud Function in hosted envs; called inline locally). Each message is
 * claimed in a transaction so concurrent senders never send it twice.
 */
export async function deliverQueuedMail(limit = 50): Promise<number> {
  const provider = getMailProvider();
  const from = getServerEnv().EMAIL_FROM_ADDRESS;
  const snap = await getDb()
    .collection("mailOutbox")
    .where("status", "==", "queued")
    .limit(limit)
    .get();
  let sent = 0;
  for (const doc of snap.docs) {
    const claimed = await getDb().runTransaction(async (tx) => {
      const current = await tx.get(doc.ref);
      if (current.get("status") !== "queued") return false;
      tx.update(doc.ref, { status: "sending", attempts: FieldValue.increment(1) });
      return true;
    });
    if (!claimed) continue;
    const message = doc.data() as MailMessage & { attempts?: number };
    try {
      const { brand, override } = await brandForMessage(message);
      const rendered = renderMail(message.template, message.variables, brand, override);
      const result = await provider.send({
        from: fromHeader(brand.appName, from),
        to: message.to,
        ...rendered,
      });
      await doc.ref.update({
        status: "sent",
        providerId: result.id,
        provider: provider.name,
        sentAt: FieldValue.serverTimestamp(),
      });
      if (
        provider.name === "console" &&
        !["staging", "production"].includes(getServerEnv().APP_ENV)
      ) {
        // Local only: surface the action link so developers can follow invitations/resets.
        logger.info("mail.console_delivery", {
          template: message.template,
          link: message.variables.link ?? null,
        });
      }
      sent++;
    } catch (error) {
      const attempts = (message.attempts ?? 0) + 1;
      await doc.ref.update({
        status: attempts >= MAX_ATTEMPTS ? "dead" : "queued",
        lastError: error instanceof Error ? error.message.slice(0, 200) : "unknown",
      });
      logger.error("mail.delivery_failed", { template: message.template, attempts });
    }
  }
  return sent;
}
