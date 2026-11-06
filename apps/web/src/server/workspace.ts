import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import { headers } from "next/headers";
import { getPublicBranding } from "@crm/core/branding/resolve";
import { AppError } from "@crm/core/errors";
import {
  getPublicWorkspaceName,
  requireTenantContext,
  type TenantContext,
} from "@crm/core/contexts/tenant";
import { sessionPolicy } from "@crm/core/session";
import { newRequestId } from "@crm/core/request-id";
import { nextRequestSource } from "./request";

export type WorkspaceAccess =
  | { status: "ok"; ctx: TenantContext }
  | { status: "unauthenticated" | "forbidden" | "suspended" | "not_found" };

/** Per-request (React cache) resolution of the current user's access to this host's workspace. */
export const getWorkspaceAccess = cache(async (): Promise<WorkspaceAccess> => {
  await connection(); // request-time only: uses random request IDs and clock-based caches
  const req = await nextRequestSource();
  try {
    const ctx = await requireTenantContext({
      host: req.host,
      sessionCookie: req.cookie(sessionPolicy("workspace", req.secure).cookieName),
      requestId: newRequestId(),
    });
    return { status: "ok", ctx };
  } catch (error) {
    const code = error instanceof AppError ? error.code : "INTERNAL";
    if (code === "UNAUTHENTICATED") return { status: "unauthenticated" };
    if (code === "FORBIDDEN") return { status: "forbidden" };
    if (code === "TENANT_SUSPENDED") return { status: "suspended" };
    if (code === "NOT_FOUND") return { status: "not_found" };
    throw error;
  }
});

/**
 * Public branding for the login page (FR-PUB-003): workspace display name only —
 * never members, counts, or anything else. Null for unknown hosts.
 */
export const getPublicWorkspace = cache(async (): Promise<{ name: string } | null> => {
  await connection();
  const req = await nextRequestSource();
  const name = await getPublicWorkspaceName(req.host);
  return name ? { name } : null;
});

/** Resolved public branding of this host's workspace (logo, name, colours, powered-by). */
export const getHostBranding = cache(async () => {
  await connection();
  const req = await nextRequestSource();
  return getPublicBranding(req.host);
});

/** The CSP nonce the proxy generated for this request (for inline <style>). */
export const getNonce = cache(async (): Promise<string | undefined> => {
  return (await headers()).get("x-nonce") ?? undefined;
});
