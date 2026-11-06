import "server-only";
import type { Timestamp } from "firebase-admin/firestore";
import type { AgencyRole, PlatformRole, WorkspaceRole } from "@crm/shared/permissions";

// Firestore document shapes used by Phase 2 (requirements/03 §4–5). Timestamps are
// Firestore Timestamps at rest; typed loosely here and converted at the edges.

export type LifecycleStatus = "active" | "suspended" | "pending_deletion" | "deleted";
export type MembershipStatus = "active" | "disabled";

export interface AgencyDoc {
  name: string;
  slug: string;
  status: LifecycleStatus;
  ownerUid: string | null;
  quotas: { maxWorkspaces: number; maxSeatsTotal: number };
  entitlements: {
    canProvisionWorkspaces: boolean;
    allowWorkspaceBranding: boolean;
    removePoweredBy: boolean;
  };
  branding: Record<string, unknown>;
  billing: {
    mode: "gateway" | "manual";
    provider: string | null;
    env: "test" | "live";
    currency: string;
  };
  usage: { workspaces: number; seats: number };
  /** FR-TEN-009 base domain for workspace subdomains. */
  baseDomain?: string | null;
  schemaVersion: number;
}

export interface TenantDoc {
  agencyId: string;
  name: string;
  slug: string;
  status: LifecycleStatus;
  canonicalHost: string;
  planId: string;
  billingState: "trialing" | "active" | "past_due" | "read_only" | "manual_active";
  ownerUid: string | null;
  branding: Record<string, unknown>;
  settings: { timezone: string; locale: string; currency: string };
  entitlementOverrides?: Record<string, unknown>;
  featureFlags?: Record<string, unknown>;
  trialEndsAt?: unknown;
  schemaVersion: number;
}

export interface TenantDomainDoc {
  tenantId: string | null;
  agencyId: string;
  type: "platform_subdomain" | "agency_subdomain" | "agency_base" | "custom";
  status: "pending_dns" | "verifying" | "active" | "error" | "removing";
  isCanonical: boolean;
}

export interface MemberDoc {
  uid: string;
  tenantId: string;
  email: string;
  displayName: string;
  role: WorkspaceRole;
  status: MembershipStatus;
  viaAgencyStaff?: boolean;
}

export interface StaffDoc {
  uid: string;
  agencyId: string;
  email: string;
  displayName: string;
  role: AgencyRole;
  status: MembershipStatus;
}

export interface PlatformAdminDoc {
  role: PlatformRole;
  email: string;
}

export type InvitationTarget =
  | { kind: "workspace"; tenantId: string; role: WorkspaceRole }
  | { kind: "agency"; agencyId: string; role: AgencyRole };

export interface InvitationDoc {
  email: string;
  target: InvitationTarget;
  status: "pending" | "accepted" | "revoked" | "expired";
  invitedBy: string;
  /** Host the invite link points at; acceptance must happen on this host. */
  host: string;
  expiresAt: Timestamp;
  resendCount: number;
}

export interface UserDoc {
  email: string;
  displayName: string;
  tenantIds: string[];
  agencyIds: string[];
}
