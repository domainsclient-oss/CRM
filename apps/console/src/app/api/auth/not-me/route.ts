import { NextResponse } from "next/server";
import { revokeWithAlertToken } from "@crm/core/services/auth";
import { newRequestId } from "@crm/core/request-id";
import { isSameOrigin, normalizeHost } from "@crm/shared/hosts";
import { tokenSchema } from "@crm/shared/schemas/auth";

// "This wasn't me" (FR-AUTH-008 AC4). Revocation happens only on a same-origin POST from the
// confirmation page; GET (older emailed links) just forwards to that page. Single-use token;
// revokes all sessions for the account, then sends the user to sign in again. PROTECTED FILE.

function redirect(request: Request, path: string) {
  const response = NextResponse.redirect(new URL(path, request.url), 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export function GET(request: Request) {
  const token = tokenSchema.safeParse(new URL(request.url).searchParams.get("t"));
  return redirect(request, token.success ? `/not-me?t=${token.data}` : "/not-me");
}

export async function POST(request: Request) {
  const host = normalizeHost(request.headers.get("host"));
  if (!host || !isSameOrigin(request.headers.get("origin"), host)) {
    return new Response("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const form = await request.formData().catch(() => null);
  const parsed = tokenSchema.safeParse(form?.get("t"));
  const revoked = parsed.success ? await revokeWithAlertToken(parsed.data, newRequestId()) : false;
  return redirect(request, `/login?revoked=${revoked ? "1" : "0"}`);
}
