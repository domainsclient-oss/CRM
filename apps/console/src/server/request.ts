import "server-only";
import { cookies, headers } from "next/headers";
import type { RequestInfo, RequestSource } from "@crm/core/actions";

// Adapter from Next.js request APIs to the framework-neutral RequestInfo used by
// @crm/core. The Host header (set by the platform) decides which workspace is targeted;
// access is still granted only by the session + membership checks in core.

export const nextRequestSource: RequestSource = async (): Promise<RequestInfo> => {
  const h = await headers();
  const c = await cookies();
  const host = (h.get("host") ?? "").toLowerCase();
  const proto = h.get("x-forwarded-proto");
  const secure = proto ? proto === "https" : !host.includes("localhost");
  const forwardedFor = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    host,
    origin: h.get("origin"),
    secure,
    ip: forwardedFor || h.get("x-real-ip") || null,
    userAgent: h.get("user-agent"),
    cookie: (name) => c.get(name)?.value,
  };
};
