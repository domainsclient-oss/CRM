import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";
import type { WorkspaceRole } from "@crm/shared/permissions";
import { AGENCIES, WORKSPACES, buildAgency, buildWorkspace, uidFor } from "@crm/testing/fixtures";
import { resetEmulators, seedTenancy } from "@crm/testing/seed";
import type { AgencyContext } from "../contexts/agency-context";
import { clearTenantCaches, type TenantContext } from "../contexts/tenant-context";
import { getDb } from "../firebase-admin";
import { logger } from "../logger";
import type { AgencyDoc, TenantDoc } from "../model";
import { readBrandAsset } from "./assets";
import { getBrandingForTenant, getPublicBranding, resolveBranding } from "./resolve";
import { removeBrandAsset, updateBranding, uploadBrandAsset } from "./service";

// Branding (TC-BRAND-001/002, TC-AGY-004) against Firestore + Storage emulators.

const ACME = WORKSPACES.acme;

async function tenantCtx(role: WorkspaceRole): Promise<TenantContext> {
  const tenant = (await getDb().doc(`tenants/${ACME.id}`).get()).data() as TenantDoc;
  return {
    tenantId: ACME.id,
    agencyId: ACME.agencyId,
    uid: uidFor("acme", role),
    role,
    session: { uid: "x", authTime: Math.floor(Date.now() / 1000) } as never,
    tenant,
    requestId: "req_test",
    log: logger,
  };
}

function agencyCtx(key: "agencyOne" | "agencyTwo"): AgencyContext {
  return {
    agencyId: AGENCIES[key].id,
    uid: AGENCIES[key].ownerUid,
    role: "agency_owner",
    session: { uid: "x", authTime: Math.floor(Date.now() / 1000) } as never,
    agency: buildAgency(key) as unknown as AgencyDoc,
    requestId: "req_test",
    log: logger,
  };
}

const png = (w = 64, h = 32) =>
  sharp({ create: { width: w, height: h, channels: 4, background: "#1F6FEB" } })
    .png()
    .toBuffer();

async function allowWorkspaceBranding(allowed: boolean) {
  await getDb()
    .doc(`agencies/${ACME.agencyId}`)
    .update({ "entitlements.allowWorkspaceBranding": allowed });
  clearTenantCaches();
}

beforeEach(async () => {
  await resetEmulators();
  await seedTenancy(getDb());
  clearTenantCaches();
});

describe("inheritance (FR-AGY-004)", () => {
  it("resolves platform → agency → workspace, honouring allowWorkspaceBranding", () => {
    const agency = buildAgency("agencyOne") as unknown as AgencyDoc;
    const tenant = {
      ...buildWorkspace("acme"),
      branding: { appName: "Acme CRM" },
    } as unknown as TenantDoc;
    const allowed = resolveBranding(agency, tenant);
    expect(allowed).toMatchObject({ appName: "Acme CRM", primaryColor: "#1F6FEB" });
    expect(allowed.source).toMatchObject({
      appName: "workspace",
      primaryColor: "agency",
      logoLightPath: "platform",
    });
    const blocked = resolveBranding(
      { ...agency, entitlements: { ...agency.entitlements, allowWorkspaceBranding: false } },
      tenant,
    );
    expect(blocked.appName).toBe(AGENCIES.agencyOne.name);
    expect(resolveBranding(null, null).appName).toBe("CRM");
  });

  it("agency branding reaches non-overridden workspaces", async () => {
    await updateBranding(
      { kind: "agency", ctx: agencyCtx("agencyOne") },
      { level: "agency" },
      {
        appName: "OneCRM",
        primaryColor: "#0F766E",
        accentColor: null,
      },
    );
    const globex = await getBrandingForTenant(WORKSPACES.globex.id);
    expect(globex).toMatchObject({ appName: "OneCRM", primaryColor: "#0F766E" });
    const pub = await getPublicBranding(WORKSPACES.globex.canonicalHost);
    expect(pub).toMatchObject({ appName: "OneCRM", workspaceName: WORKSPACES.globex.name });
  });
});

describe("who may edit (FR-BRAND-001 AC0)", () => {
  it("workspace admins edit only when the agency allows it; viewers never", async () => {
    await allowWorkspaceBranding(false);
    const input = { appName: "Acme CRM", primaryColor: null, accentColor: null };
    await expect(
      updateBranding(
        { kind: "tenant", ctx: await tenantCtx("owner") },
        { level: "workspace", tenantId: ACME.id },
        input,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await allowWorkspaceBranding(true);
    await expect(
      updateBranding(
        { kind: "tenant", ctx: await tenantCtx("viewer") },
        { level: "workspace", tenantId: ACME.id },
        input,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await updateBranding(
      { kind: "tenant", ctx: await tenantCtx("admin") },
      { level: "workspace", tenantId: ACME.id },
      input,
    );
    expect(await getBrandingForTenant(ACME.id)).toMatchObject({ appName: "Acme CRM" });

    // A workspace can't target another workspace.
    await expect(
      updateBranding(
        { kind: "tenant", ctx: await tenantCtx("owner") },
        { level: "workspace", tenantId: WORKSPACES.globex.id },
        input,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("agency staff edit only their own agency's workspaces (TC-AGY-003)", async () => {
    await allowWorkspaceBranding(false);
    const input = { appName: "Agency set", primaryColor: null, accentColor: null };
    await expect(
      updateBranding(
        { kind: "agency", ctx: agencyCtx("agencyTwo") },
        { level: "workspace", tenantId: ACME.id },
        input,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await updateBranding(
      { kind: "agency", ctx: agencyCtx("agencyOne") },
      { level: "workspace", tenantId: ACME.id },
      input,
    );
    const audit = await getDb()
      .collection(`agencies/${ACME.agencyId}/auditLogs`)
      .where("action", "==", "branding.updated")
      .get();
    expect(audit.size).toBe(1);
  });

  it("blocks colours that can't meet contrast and suggests one (TC-BRAND-002)", async () => {
    await allowWorkspaceBranding(true);
    const error = await updateBranding(
      { kind: "tenant", ctx: await tenantCtx("owner") },
      { level: "workspace", tenantId: ACME.id },
      { appName: null, primaryColor: "#777777", accentColor: null },
    ).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "VALIDATION" });
    expect(JSON.stringify((error as { fieldErrors: unknown }).fieldErrors)).toMatch(
      /Try #[0-9A-F]{6}/,
    );
  });
});

describe("upload pipeline (TC-BRAND-001, NFR-SEC-009)", () => {
  const actor = async () => ({ kind: "tenant" as const, ctx: await tenantCtx("owner") });
  const target = { level: "workspace" as const, tenantId: ACME.id };

  it("re-encodes, strips metadata, and stores by content hash", async () => {
    await allowWorkspaceBranding(true);
    const withExif = await sharp(await png())
      .withMetadata({ exif: { IFD0: { Copyright: "secret-gps" } } })
      .jpeg()
      .toBuffer();
    const { path } = await uploadBrandAsset(await actor(), target, "logoLight", withExif);
    expect(path).toMatch(new RegExp(`^tenant_${ACME.id}/[a-f0-9]{64}\\.jpg$`));
    const asset = await readBrandAsset(path);
    expect(asset?.contentType).toBe("image/jpeg");
    expect((await sharp(asset!.body).metadata()).exif).toBeUndefined();
    expect(asset!.body.includes(Buffer.from("secret-gps"))).toBe(false);
    expect(await getBrandingForTenant(ACME.id)).toMatchObject({ logoLightPath: path });

    await removeBrandAsset(await actor(), target, "logoLight");
    expect(await getBrandingForTenant(ACME.id)).toMatchObject({ logoLightPath: null });
  });

  it.each([
    [
      "SVG",
      () =>
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" onload="alert(1)"><rect width="10" height="10"/></svg>',
        ),
      /SVG/,
    ],
    [
      "HTML renamed as PNG",
      () => Buffer.from("<html><script>alert(1)</script></html>"),
      /supported image/,
    ],
    ["oversized dimensions", () => png(3000, 10), /at most 2048/],
    ["too many bytes", () => Buffer.alloc(1024 * 1024 + 1, 1), /larger than/],
  ])("rejects %s", async (_label, make, message) => {
    await allowWorkspaceBranding(true);
    const error = await uploadBrandAsset(await actor(), target, "logoLight", await make()).catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({ code: "VALIDATION" });
    expect(JSON.stringify((error as { fieldErrors: unknown }).fieldErrors)).toMatch(message);
  });

  it("favicons must be PNG", async () => {
    await allowWorkspaceBranding(true);
    const jpeg = await sharp(await png(32, 32))
      .jpeg()
      .toBuffer();
    await expect(uploadBrandAsset(await actor(), target, "favicon", jpeg)).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(
      uploadBrandAsset(await actor(), target, "favicon", await png(32, 32)),
    ).resolves.toBeDefined();
  });

  it("serves only well-formed asset paths", async () => {
    expect(await readBrandAsset("../secrets.txt")).toBeNull();
    expect(await readBrandAsset(`tenant_x/${"a".repeat(64)}.png`)).toBeNull();
  });
});
