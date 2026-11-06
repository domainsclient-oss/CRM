import "server-only";
import { z } from "zod";
import type { AgencyContext } from "./contexts/agency-context";
import type { PlatformContext } from "./contexts/platform-context";
import { addAgencySubdomain, addDomain, setAgencyBaseDomain } from "./domains/service";
import { getDb } from "./firebase-admin";
import { logger } from "./logger";
import type { AgencyDoc } from "./model";
import { provisionAgency, provisionWorkspace } from "./services/provisioning";

// UAT environment setup (T-10-02): a pilot agency with client workspaces, provisioned through the
// same services the consoles use — owners receive real invitations, domains start in pending DNS.
// Idempotent per config (stable idempotency keys), so a re-run doesn't duplicate anything.

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/);
export const pilotConfigSchema = z.strictObject({
  agency: z.strictObject({
    name: z.string().min(2).max(80),
    slug,
    ownerEmail: z.email(),
    maxWorkspaces: z.number().int().min(1).default(10),
    maxSeatsTotal: z.number().int().min(1).default(100),
    baseDomain: z.string().min(4).nullable().default(null),
  }),
  workspaces: z
    .array(
      z.strictObject({
        name: z.string().min(2).max(80),
        slug,
        ownerEmail: z.email(),
        domain: z
          .discriminatedUnion("type", [
            z.strictObject({ type: z.literal("custom"), host: z.string().min(4) }),
            z.strictObject({ type: z.literal("agency_subdomain") }),
          ])
          .nullable()
          .default(null),
      }),
    )
    .min(1)
    .max(20),
});
export type PilotConfig = z.input<typeof pilotConfigSchema>;

export interface PilotResult {
  agencyId: string;
  workspaces: Array<{ slug: string; tenantId: string; host: string; domain: string | null }>;
}

export async function provisionPilot(
  operator: PlatformContext,
  rawConfig: PilotConfig,
): Promise<PilotResult> {
  const config = pilotConfigSchema.parse(rawConfig);
  const key = (what: string) => `uat-${config.agency.slug}-${what}`.slice(0, 64);
  const { agencyId } = await provisionAgency(operator, {
    ...config.agency,
    canProvisionWorkspaces: false,
    idempotencyKey: key("agency"),
  });

  const agencyCtx = async (): Promise<AgencyContext> => ({
    agencyId,
    uid: operator.uid,
    role: "agency_owner",
    session: operator.session,
    agency: (await getDb().doc(`agencies/${agencyId}`).get()).data() as AgencyDoc,
    requestId: operator.requestId,
    log: operator.log,
  });
  if (config.agency.baseDomain)
    await setAgencyBaseDomain(await agencyCtx(), config.agency.baseDomain);

  const workspaces: PilotResult["workspaces"] = [];
  for (const ws of config.workspaces) {
    const { tenantId, host } = await provisionWorkspace(
      { kind: "platform", ctx: operator },
      {
        agencyId,
        name: ws.name,
        slug: ws.slug,
        ownerEmail: ws.ownerEmail,
        idempotencyKey: key(`ws-${ws.slug}`),
      },
    );
    let domain: string | null = null;
    const existing = await getDb()
      .collection("tenantDomains")
      .where("tenantId", "==", tenantId)
      .get();
    if (ws.domain?.type === "custom") {
      domain = ws.domain.host.toLowerCase();
      if (!existing.docs.some((d) => d.id === domain)) {
        await addDomain({ kind: "platform", ctx: operator }, tenantId, domain);
      }
    } else if (ws.domain?.type === "agency_subdomain") {
      if (!config.agency.baseDomain)
        throw new Error(`${ws.slug}: agency_subdomain needs agency.baseDomain`);
      domain = `${ws.slug}.${config.agency.baseDomain}`.toLowerCase();
      if (!existing.docs.some((d) => d.id === domain)) {
        await addAgencySubdomain({ kind: "agency", ctx: await agencyCtx() }, tenantId);
      }
    }
    workspaces.push({ slug: ws.slug, tenantId, host, domain });
  }
  logger.info("uat.pilot_provisioned", {
    requestId: operator.requestId,
    agencyId,
    workspaces: workspaces.length,
  });
  return { agencyId, workspaces };
}
