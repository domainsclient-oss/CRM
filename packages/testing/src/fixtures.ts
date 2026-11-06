// Canonical fictional test scenario (requirements/05 §10, 09 §13).
// Agency One → Acme (custom domain), Globex (agency subdomain); Agency Two → Initech.
// Every workspace has all five roles; Raj and Lena are Members with disjoint records
// so own-only visibility (FR-RBAC-004) and isolation tests share one dataset.

export const WORKSPACE_ROLES = ["owner", "admin", "manager", "member", "viewer"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const AGENCIES = {
  agencyOne: { id: "agy_one", slug: "agency-one", name: "Agency One Digital", ownerUid: "u_priya" },
  agencyTwo: { id: "agy_two", slug: "agency-two", name: "Agency Two Partners", ownerUid: "u_tom" },
} as const;

export const WORKSPACES = {
  acme: {
    id: "tnt_acme",
    agencyId: AGENCIES.agencyOne.id,
    slug: "acme",
    name: "Acme Widgets Ltd",
    canonicalHost: "crm.acme.test",
  },
  globex: {
    id: "tnt_globex",
    agencyId: AGENCIES.agencyOne.id,
    slug: "globex",
    name: "Globex Corporation",
    canonicalHost: "globex.crm.agency-one.test",
  },
  initech: {
    id: "tnt_initech",
    agencyId: AGENCIES.agencyTwo.id,
    slug: "initech",
    name: "Initech",
    canonicalHost: "initech.app.localhost",
  },
} as const;

export type WorkspaceKey = keyof typeof WORKSPACES;

/** Deterministic uid per workspace and role, e.g. u_acme_owner. Members Raj/Lena are extra. */
export function uidFor(workspace: WorkspaceKey, role: WorkspaceRole | "member2"): string {
  return `u_${workspace}_${role}`;
}

export const PEOPLE = {
  raj: { uid: uidFor("acme", "member"), displayName: "Raj Patel" },
  lena: { uid: uidFor("acme", "member2"), displayName: "Lena Fischer" },
  sam: { uid: "u_sam", displayName: "Sam Rivera" }, // viewer in Acme, admin in Globex
  priya: { uid: AGENCIES.agencyOne.ownerUid, displayName: "Priya Nair" },
  tom: { uid: AGENCIES.agencyTwo.ownerUid, displayName: "Tom Becker" },
  platformAdmin: { uid: "u_ops", displayName: "Ops Admin" },
} as const;

const FIXED_DATE = new Date("2026-11-01T09:00:00Z");

export function buildAgency(key: keyof typeof AGENCIES) {
  const agency = AGENCIES[key];
  return {
    ...agency,
    status: "active",
    quotas: { maxWorkspaces: 50, maxSeatsTotal: 500 },
    entitlements: {
      canProvisionWorkspaces: false,
      allowWorkspaceBranding: true,
      removePoweredBy: false,
    },
    branding: { appName: agency.name, primaryColor: "#1F6FEB", accentColor: "#F59E0B" },
    billing: { mode: "manual", provider: null, env: "test", currency: "USD" },
    createdAt: FIXED_DATE,
    schemaVersion: 1,
  };
}

export function buildWorkspace(key: WorkspaceKey) {
  const ws = WORKSPACES[key];
  return {
    ...ws,
    status: "active",
    planId: "growth",
    billingState: "active",
    ownerUid: uidFor(key, "owner"),
    branding: {},
    settings: { timezone: "Europe/London", locale: "en-GB", currency: "GBP" },
    createdAt: FIXED_DATE,
    schemaVersion: 1,
  };
}

export function buildMember(workspace: WorkspaceKey, uid: string, role: WorkspaceRole) {
  return {
    uid,
    tenantId: WORKSPACES[workspace].id,
    email: `${uid}@example.test`,
    displayName: uid,
    role,
    status: "active",
    joinedAt: FIXED_DATE,
  };
}

export function buildContact(
  workspace: WorkspaceKey,
  id: string,
  ownerUid: string,
  overrides: Partial<{ firstName: string; lastName: string; email: string }> = {},
) {
  const firstName = overrides.firstName ?? "Test";
  const lastName = overrides.lastName ?? id;
  return {
    id,
    tenantId: WORKSPACES[workspace].id,
    firstName,
    lastName,
    fullNameLower: `${firstName} ${lastName}`.toLowerCase(),
    email: overrides.email ?? `${id}@customer.example`,
    ownerUid,
    lifecycleStage: "lead",
    tags: [],
    isDeleted: false,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    createdBy: ownerUid,
    updatedBy: ownerUid,
    schemaVersion: 1,
  };
}

/** Every document path pattern in requirements/03 §2, with sample IDs, for rules tests. */
export const SAMPLE_PATHS: readonly string[] = [
  `users/${PEOPLE.raj.uid}`,
  `platformAdmins/${PEOPLE.platformAdmin.uid}`,
  "plans/growth",
  "tenantSlugs/acme",
  "agencySlugs/agency-one",
  "tenantDomains/crm.acme.test",
  "invitationTokens/hash123",
  "handoffTokens/hash123",
  "idempotencyKeys/u_x_key",
  "paymentEvents/razorpay_evt_1",
  "privilegedSessions/ps_1",
  "revocationTokens/hash123",
  "users/u_ops",
  "mailOutbox/m_1",
  "platformAuditLogs/pa_1",
  "erasureLog/e_1",
  "migrations/0001",
  `agencies/${AGENCIES.agencyOne.id}`,
  `agencies/${AGENCIES.agencyOne.id}/staff/${PEOPLE.priya.uid}`,
  `agencies/${AGENCIES.agencyOne.id}/planPrices/growth`,
  `agencies/${AGENCIES.agencyOne.id}/auditLogs/al_1`,
  ...[
    "",
    `/members/${PEOPLE.raj.uid}`,
    "/invitations/inv_1",
    "/companies/co_1",
    "/contacts/c_1",
    "/leads/l_1",
    "/deals/d_1",
    "/pipelines/default",
    "/tasks/t_1",
    "/activities/a_1",
    "/notifications/n_1",
    "/tagDefinitions/tag_1",
    "/emailTemplates/invitation",
    "/jobs/j_1",
    "/usage/current",
    "/billing/subscription",
    "/billingHistory/bh_1",
    "/auditLogs/al_1",
  ].map((suffix) => `tenants/${WORKSPACES.acme.id}${suffix}`),
];
