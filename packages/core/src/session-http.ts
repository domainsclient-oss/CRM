import "server-only";
import { z } from "zod";
import { HTTP_STATUS } from "@crm/shared/errors";
import { classifyHost, isSameOrigin, normalizeHost, type HostClass } from "@crm/shared/hosts";
import { idTokenSchema } from "@crm/shared/schemas/auth";
import { AppError, toActionError } from "./errors";
import { POLICIES, enforceRateLimit, RateLimitError } from "./rate-limit";
import { newRequestId } from "./request-id";
import { getServerEnv } from "./server-env";
import { sessionPolicy, type SessionKind } from "./session";
import {
  endSession,
  startConsoleSession,
  startPartnersSession,
  startWorkspaceSession,
  type ClientInfo,
} from "./services/auth";

// Session endpoints for Route Handlers (FR-AUTH-004/006). Standard Request/Response so
// both apps share one implementation. CSRF: custom header (forces a CORS preflight that we
// never allow) + same-origin Origin check (requirements/04 §8; phase-2-plan decision 3).

export const CSRF_HEADER = "x-crm-request";

const KIND_BY_HOST: Partial<Record<HostClass, SessionKind>> = {
  workspace: "workspace",
  console: "console",
  partners: "partners",
};

function hostConfig() {
  const env = getServerEnv();
  return {
    marketingHost: env.APP_MARKETING_HOST ?? "localhost:3000",
    consoleHost: env.APP_CONSOLE_HOST ?? "console.localhost:3001",
    partnersHost: env.APP_PARTNERS_HOST ?? "partners.localhost:3001",
  };
}

function clientInfo(request: Request, requestId: string): ClientInfo & { kind: SessionKind } {
  const host = normalizeHost(request.headers.get("host"));
  if (!host) throw new AppError("NOT_FOUND", "bad_host");
  if (
    request.headers.get(CSRF_HEADER) !== "1" ||
    !isSameOrigin(request.headers.get("origin"), host)
  ) {
    throw new AppError("FORBIDDEN", "csrf");
  }
  const kind = KIND_BY_HOST[classifyHost(host, hostConfig())];
  if (!kind) throw new AppError("NOT_FOUND", "no_sessions_on_this_host");
  const proto = request.headers.get("x-forwarded-proto");
  return {
    kind,
    host,
    secure: proto ? proto === "https" : !host.includes("localhost"),
    ip:
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip"),
    userAgent: request.headers.get("user-agent"),
    requestId,
  };
}

export function serializeCookie(
  name: string,
  value: string,
  opts: { maxAgeSeconds: number; secure: boolean },
): string {
  return [
    `${name}=${value}`,
    "Path=/",
    `Max-Age=${opts.maxAgeSeconds}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(opts.secure ? ["Secure"] : []),
  ].join("; ");
}

function json(body: unknown, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extraHeaders },
  });
}

function errorResponse(error: unknown, requestId: string): Response {
  const err = toActionError(error, requestId);
  const headers: Record<string, string> =
    error instanceof RateLimitError ? { "Retry-After": String(error.retryAfterSeconds) } : {};
  return json({ ok: false, error: err }, HTTP_STATUS[err.code], headers);
}

const bodySchema = z.strictObject({ idToken: idTokenSchema });

/** POST: exchange a fresh ID token for a session cookie on this host. */
export async function handleCreateSession(request: Request): Promise<Response> {
  const requestId = newRequestId();
  try {
    const client = clientInfo(request, requestId);
    const policy =
      client.kind === "workspace" ? POLICIES.sessionCreateByIp : POLICIES.privilegedSignInByIp;
    await enforceRateLimit(policy, client.ip ?? "unknown-ip");
    const { idToken } = bodySchema.parse(await request.json().catch(() => ({})));
    const start = {
      workspace: startWorkspaceSession,
      console: startConsoleSession,
      partners: startPartnersSession,
    }[client.kind];
    const minted = await start(idToken, client);
    return json({ ok: true }, 200, {
      "Set-Cookie": serializeCookie(minted.cookieName, minted.cookie, {
        maxAgeSeconds: minted.maxAgeSeconds,
        secure: client.secure,
      }),
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

/** DELETE: revoke sessions everywhere and clear the cookie (FR-AUTH-006). */
export async function handleDeleteSession(request: Request): Promise<Response> {
  const requestId = newRequestId();
  try {
    const client = clientInfo(request, requestId);
    const { cookieName } = sessionPolicy(client.kind, client.secure);
    const cookie = readCookie(request.headers.get("cookie"), cookieName);
    await endSession(cookie, { kind: client.kind, host: client.host }, requestId);
    return json({ ok: true }, 200, {
      "Set-Cookie": serializeCookie(cookieName, "", { maxAgeSeconds: 0, secure: client.secure }),
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}
