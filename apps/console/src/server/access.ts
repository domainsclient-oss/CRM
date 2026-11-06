import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import { requireAgencyContext, type AgencyContext } from "@crm/core/contexts/agency";
import { requirePlatformContext, type PlatformContext } from "@crm/core/contexts/platform";
import { AppError } from "@crm/core/errors";
import { newRequestId } from "@crm/core/request-id";
import { sessionPolicy } from "@crm/core/session";
import { nextRequestSource } from "./request";

type Denied = { status: "unauthenticated" | "forbidden" | "suspended" };

function denied(error: unknown): Denied {
  const code = error instanceof AppError ? error.code : null;
  if (code === "UNAUTHENTICATED") return { status: "unauthenticated" };
  if (code === "FORBIDDEN") return { status: "forbidden" };
  if (code === "TENANT_SUSPENDED") return { status: "suspended" };
  throw error;
}

export const getPlatformAccess = cache(
  async (): Promise<{ status: "ok"; ctx: PlatformContext } | Denied> => {
    await connection();
    const req = await nextRequestSource();
    try {
      const ctx = await requirePlatformContext({
        host: req.host,
        sessionCookie: req.cookie(sessionPolicy("console", req.secure).cookieName),
        requestId: newRequestId(),
      });
      return { status: "ok", ctx };
    } catch (error) {
      return denied(error);
    }
  },
);

export const getAgencyAccess = cache(
  async (): Promise<{ status: "ok"; ctx: AgencyContext } | Denied> => {
    await connection();
    const req = await nextRequestSource();
    try {
      const ctx = await requireAgencyContext({
        host: req.host,
        sessionCookie: req.cookie(sessionPolicy("partners", req.secure).cookieName),
        selectedAgencyId: req.cookie("agency"),
        requestId: newRequestId(),
      });
      return { status: "ok", ctx };
    } catch (error) {
      return denied(error);
    }
  },
);
