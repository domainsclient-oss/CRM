// Emulator seeding for browser E2E. Writes directly with the Admin SDK (emulator only).
import { createHash, randomBytes } from "node:crypto";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const PROJECT_ID = "demo-crm";

export function emulatorEnabled(): boolean {
  return process.env.E2E_EMULATOR === "1" && Boolean(process.env.FIRESTORE_EMULATOR_HOST);
}

function app() {
  if (!emulatorEnabled()) throw new Error("Emulator E2E only (pnpm test:e2e:auth)");
  return getApps().find((a) => a.name === "e2e") ?? initializeApp({ projectId: PROJECT_ID }, "e2e");
}
const db = () => getFirestore(app());
const auth = () => getAuth(app());

export async function resetEmulators(): Promise<void> {
  const fs = process.env.FIRESTORE_EMULATOR_HOST;
  const au = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  await fetch(`http://${fs}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, {
    method: "DELETE",
  });
  await fetch(`http://${au}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: "DELETE" });
}

export async function seedWorkspace(slug: string, host: string, name: string) {
  const agencyId = `agy_${slug}`;
  const tenantId = `tnt_${slug}`;
  await db()
    .doc(`agencies/${agencyId}`)
    .set({
      name: `${name} Agency`,
      slug: `${slug}-agency`,
      status: "active",
      ownerUid: null,
      quotas: { maxWorkspaces: 10, maxSeatsTotal: 50 },
      entitlements: {
        canProvisionWorkspaces: false,
        allowWorkspaceBranding: true,
        removePoweredBy: false,
      },
      branding: {},
      billing: { mode: "manual", provider: null, env: "test", currency: "USD" },
      usage: { workspaces: 1, seats: 0 },
      schemaVersion: 1,
    });
  await db()
    .doc(`tenants/${tenantId}`)
    .set({
      agencyId,
      name,
      slug,
      status: "active",
      canonicalHost: host,
      planId: "trial",
      billingState: "trialing",
      ownerUid: null,
      branding: {},
      settings: { timezone: "UTC", locale: "en-US", currency: "USD" },
      schemaVersion: 1,
    });
  await db().doc(`tenantDomains/${host}`).set({
    tenantId,
    agencyId,
    type: "platform_subdomain",
    status: "active",
    isCanonical: true,
  });
  return { tenantId, agencyId };
}

/** Same storage layout as @crm/core invitations: hashed token pointer + invitation doc. */
export async function seedInvitation(
  tenantId: string,
  host: string,
  email: string,
  role = "owner",
) {
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token, "utf8").digest("hex");
  const ref = db().collection(`tenants/${tenantId}/invitations`).doc();
  const expiresAt = Timestamp.fromMillis(Date.now() + 7 * 24 * 3600 * 1000);
  await ref.set({
    email,
    target: { kind: "workspace", tenantId, role },
    status: "pending",
    invitedBy: "u_ops",
    host,
    expiresAt,
    resendCount: 0,
    tokenHash: hash,
  });
  await db().doc(`invitationTokens/${hash}`).set({ path: ref.path, expireAt: expiresAt });
  return token;
}

export async function seedMember(
  tenantId: string,
  email: string,
  password: string,
  role = "member",
) {
  const user = await auth().createUser({
    email,
    password,
    emailVerified: true,
    displayName: email,
  });
  await db().doc(`tenants/${tenantId}/members/${user.uid}`).set({
    uid: user.uid,
    tenantId,
    email,
    displayName: email,
    role,
    status: "active",
  });
  await db()
    .doc(`users/${user.uid}`)
    .set({ email, tenantIds: [tenantId], agencyIds: [] });
  return user.uid;
}

export async function setWorkspaceStatus(tenantId: string, status: string) {
  await db().doc(`tenants/${tenantId}`).update({ status });
}

export async function seedAgencyInvitation(
  agencyId: string,
  host: string,
  email: string,
  role = "agency_owner",
) {
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token, "utf8").digest("hex");
  const ref = db().collection(`agencies/${agencyId}/invitations`).doc();
  const expiresAt = Timestamp.fromMillis(Date.now() + 7 * 24 * 3600 * 1000);
  await ref.set({
    email,
    target: { kind: "agency", agencyId, role },
    status: "pending",
    invitedBy: "u_ops",
    host,
    expiresAt,
    resendCount: 0,
    tokenHash: hash,
  });
  await db().doc(`invitationTokens/${hash}`).set({ path: ref.path, expireAt: expiresAt });
  return token;
}

export async function setDoc(path: string, data: Record<string, unknown>) {
  await db().doc(path).set(data, { merge: true });
}

export async function getDoc(path: string) {
  return (await db().doc(path).get()).data();
}

export async function queryOutbox(template: string) {
  const snap = await db().collection("mailOutbox").where("template", "==", template).get();
  return snap.docs.map((d) => d.data());
}

/** Insert a CRM record directly (list/pagination fixtures). Mirrors the service's stored shape. */
export async function seedContact(
  tenantId: string,
  ownerUid: string,
  firstName: string,
  extra: Record<string, unknown> = {},
) {
  const ref = db().collection(`tenants/${tenantId}/contacts`).doc();
  const now = Timestamp.now();
  await ref.set({
    id: ref.id,
    tenantId,
    firstName,
    lastName: null,
    fullNameLower: firstName.toLowerCase(),
    email: null,
    emailNormalized: null,
    phones: [],
    jobTitle: null,
    companyId: null,
    companyName: null,
    lifecycleStage: "lead",
    leadSource: null,
    address: {},
    doNotContact: false,
    notes: null,
    ownerUid,
    tags: [],
    searchTokens: [],
    lastActivityAt: null,
    isDeleted: false,
    deletedAt: null,
    deletedBy: null,
    createdAt: now,
    updatedAt: now,
    createdBy: ownerUid,
    updatedBy: ownerUid,
    schemaVersion: 1,
    ...extra,
  });
  return ref.id;
}

/** Prefix tokens like @crm/shared buildSearchTokens (2..15 chars per word). */
function tokens(...words: string[]): string[] {
  const out = new Set<string>();
  for (const w of words
    .flatMap((x) => x.toLowerCase().split(/[\s@._-]+/))
    .filter((x) => x.length >= 2)) {
    for (let i = 2; i <= Math.min(w.length, 15); i++) out.add(w.slice(0, i));
  }
  return [...out].slice(0, 60);
}

/** Seed one of each CRM record (fields as the services store them) for page sweeps. */
export async function seedCrmSample(tenantId: string, ownerUid: string) {
  const now = Timestamp.now();
  const common = (id: string) => ({
    id,
    tenantId,
    ownerUid,
    tags: ["vip"],
    searchTokens: [],
    isDeleted: false,
    deletedAt: null,
    deletedBy: null,
    createdAt: now,
    updatedAt: now,
    createdBy: ownerUid,
    updatedBy: ownerUid,
    lastActivityAt: null,
    schemaVersion: 1,
  });
  const company = db().collection(`tenants/${tenantId}/companies`).doc("co_sample");
  await company.set({
    ...common(company.id),
    name: "Sample Industries",
    nameLower: "sample industries",
    domain: "sample.test",
    domainNormalized: "sample.test",
    industry: "technology",
    sizeBand: "11-50",
    phone: null,
    website: "https://sample.test",
    address: {
      line1: null,
      line2: null,
      city: "Pune",
      region: null,
      postalCode: null,
      country: "IN",
    },
    description: null,
    counts: { contacts: 1, openDeals: 1 },
    searchTokens: tokens("Sample Industries", "sample.test"),
  });
  const contact = db().collection(`tenants/${tenantId}/contacts`).doc("ct_sample");
  await contact.set({
    ...common(contact.id),
    firstName: "Sam",
    lastName: "Sample",
    fullNameLower: "sam sample",
    email: "sam@sample.test",
    emailNormalized: "sam@sample.test",
    phones: [{ label: "work", number: "+1 555 0100" }],
    jobTitle: "Buyer",
    companyId: company.id,
    companyName: "Sample Industries",
    lifecycleStage: "opportunity",
    leadSource: "referral",
    address: {
      line1: null,
      line2: null,
      city: null,
      region: null,
      postalCode: null,
      country: null,
    },
    doNotContact: false,
    notes: null,
    convertedFromLeadId: null,
    searchTokens: tokens("Sam", "Sample", "sam@sample.test", "Sample Industries"),
  });
  const lead = db().collection(`tenants/${tenantId}/leads`).doc("ld_sample");
  await lead.set({
    ...common(lead.id),
    firstName: "Lia",
    lastName: "Lead",
    fullNameLower: "lia lead",
    email: "lia@lead.test",
    emailNormalized: "lia@lead.test",
    phone: null,
    companyName: "Lead Co",
    jobTitle: null,
    source: "website",
    status: "new",
    estimatedValue: 100000,
    currency: "USD",
    notes: null,
    convertedTo: null,
    convertedAt: null,
    convertedBy: null,
  });
  const deal = db().collection(`tenants/${tenantId}/deals`).doc("dl_sample");
  await deal.set({
    ...common(deal.id),
    name: "Sample renewal",
    nameLower: "sample renewal",
    amount: 250000,
    currency: "USD",
    pipelineId: "default",
    stageId: "stg_proposal",
    stageEnteredAt: now,
    status: "open",
    probability: 50,
    expectedCloseDate: null,
    primaryContactId: contact.id,
    primaryContactName: "Sam Sample",
    companyId: company.id,
    companyName: "Sample Industries",
    lostReason: null,
    lostReasonText: null,
    closedAt: null,
  });
  const task = db().collection(`tenants/${tenantId}/tasks`).doc("tk_sample");
  await task.set({
    ...common(task.id),
    tags: [],
    title: "Call Sam",
    description: null,
    dueDate: null,
    dueTime: null,
    dueAt: null,
    dueIsDateOnly: false,
    dueTimeZone: null,
    priority: "high",
    status: "open",
    assigneeUid: ownerUid,
    related: { type: "contact", id: contact.id, label: "Sam Sample" },
    reminderAt: null,
    reminderSentAt: null,
    completedAt: null,
  });
  return {
    companyId: company.id,
    contactId: contact.id,
    leadId: lead.id,
    dealId: deal.id,
    taskId: task.id,
  };
}

/** Adds an existing account to another workspace (multi-membership, TC-TEN-007). */
export async function addMembership(tenantId: string, uid: string, email: string, role = "member") {
  await db().doc(`tenants/${tenantId}/members/${uid}`).set({
    uid,
    tenantId,
    email,
    displayName: email,
    role,
    status: "active",
  });
  const ref = db().doc(`users/${uid}`);
  const tenantIds = ((await ref.get()).get("tenantIds") as string[] | undefined) ?? [];
  await ref.set({ tenantIds: [...new Set([...tenantIds, tenantId])] }, { merge: true });
}

/** Phase 6b: connect an agency to the mock gateway (secrets in the emulator) and price a plan. */
export async function seedMockGateway(
  agencyId: string,
  webhookSecret: string,
  gatewayPlanId: string,
) {
  const refs: Record<string, string> = {};
  for (const [kind, value] of [
    ["keyId", "mock_key_1234"],
    ["keySecret", "mock_secret"],
    ["webhookSecret", webhookSecret],
  ] as const) {
    const id = `agy_${agencyId}-razorpay-${kind}`;
    await db().doc(`_localSecrets/${id}`).set({ value });
    refs[kind] = `local/${id}`;
  }
  await db().doc(`agencies/${agencyId}`).update({
    "billing.mode": "gateway",
    "billing.provider": "razorpay",
    "billing.env": "test",
    "billing.secretRefs": refs,
    "billing.keyIdHint": "1234",
  });
  const m = /^plan_(\d+)_([A-Z]{3})_(month|year)$/.exec(gatewayPlanId)!;
  await db()
    .doc(`agencies/${agencyId}/planPrices/growth`)
    .set({
      planId: "growth",
      gatewayPlanId,
      provider: "razorpay",
      amount: Number(m[1]),
      currency: m[2],
      interval: m[3],
      active: true,
    });
}

/** Phase 6b: change a mock gateway subscription, as the provider would. */
export async function setMockGatewaySubscription(id: string, status: string, periodEndMs: number) {
  await db().doc(`_mockGateway/${id}`).update({ status, currentPeriodEnd: periodEndMs });
}
