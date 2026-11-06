import "server-only";
import type { TenantContext } from "../contexts/tenant-context";
import { loadMembership, loadTenantDoc } from "../contexts/tenant-context";
import { ForbiddenError } from "../errors";
import { logger } from "../logger";

/**
 * Jobs act with the requester's current permissions (re-checked when the job runs, not when it was
 * queued): a removed or demoted member's queued import can't write anything it no longer may.
 */
export async function contextForJob(
  tenantId: string,
  uid: string,
  jobId: string,
): Promise<TenantContext> {
  const [tenant, member] = await Promise.all([
    loadTenantDoc(tenantId),
    loadMembership(tenantId, uid),
  ]);
  if (!tenant || tenant.status !== "active" || !member)
    throw new ForbiddenError("requester_inactive");
  return {
    tenantId,
    agencyId: tenant.agencyId,
    uid,
    role: member.role,
    session: { uid, authTime: Math.floor(Date.now() / 1000) } as never,
    tenant,
    requestId: `job_${jobId}`,
    log: logger.child({ tenantId, jobId }),
  };
}
