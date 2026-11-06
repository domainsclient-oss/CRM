import "server-only";
import { isAgencyRole, type AgencyRole } from "@crm/shared/permissions";
import { AppError, ForbiddenError, UnauthenticatedError } from "../errors";
import { getDb } from "../firebase-admin";
import { logger, type Logger } from "../logger";
import type { AgencyDoc, StaffDoc, UserDoc } from "../model";
import { verifySession, type Session } from "../session";

// Agency console context (partners host, FR-AGY-002/003). The agency comes from the
// user's own staff record, never from the request; a user who staffs several agencies
// may select one, but only among their own staff records.

export interface AgencyContext {
  agencyId: string;
  uid: string;
  role: AgencyRole;
  session: Session;
  agency: AgencyDoc;
  requestId: string;
  log: Logger;
}

/**
 * Candidate agencies from users/{uid}.agencyIds (kept in sync transactionally with staff
 * docs). Only a hint for selection — the staff document itself is always re-checked.
 */
export async function listStaffAgencies(uid: string): Promise<string[]> {
  const snap = await getDb().doc(`users/${uid}`).get();
  const ids = (snap.data() as UserDoc | undefined)?.agencyIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

export async function requireAgencyContext(input: {
  /** Request host; the session cookie must have been issued for it. */
  host: string;
  sessionCookie: string | undefined;
  /** Optional selection (e.g. from a cookie); validated against the user's staff records. */
  selectedAgencyId?: string | undefined;
  requestId: string;
}): Promise<AgencyContext> {
  const session = await verifySession(input.sessionCookie, {
    kind: "partners",
    host: input.host,
  });
  if (!session) throw new UnauthenticatedError();

  const agencies = await listStaffAgencies(session.uid);
  const agencyId =
    input.selectedAgencyId && agencies.includes(input.selectedAgencyId)
      ? input.selectedAgencyId
      : agencies[0];
  if (!agencyId) throw new ForbiddenError("no_agency_staff_record");

  const [agencySnap, staffSnap] = await Promise.all([
    getDb().doc(`agencies/${agencyId}`).get(),
    getDb().doc(`agencies/${agencyId}/staff/${session.uid}`).get(),
  ]);
  const agency = agencySnap.data() as AgencyDoc | undefined;
  const staff = staffSnap.data() as StaffDoc | undefined;
  if (!staff || staff.status !== "active" || !isAgencyRole(staff.role)) {
    throw new ForbiddenError("no_agency_staff_record");
  }
  if (!agency || agency.status !== "active")
    throw new AppError("TENANT_SUSPENDED", "agency_inactive");

  return {
    agencyId,
    uid: session.uid,
    role: staff.role,
    session,
    agency,
    requestId: input.requestId,
    log: logger.child({ requestId: input.requestId, agencyId, uid: session.uid }),
  };
}
