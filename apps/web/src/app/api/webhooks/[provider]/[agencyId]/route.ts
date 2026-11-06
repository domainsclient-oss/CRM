import { connection } from "next/server";
import { enforceRateLimit } from "@crm/core/rate-limit";
import { receiveWebhook } from "@crm/core/payments";
import { newRequestId } from "@crm/core/request-id";

// Payment webhooks (FR-BILL-003, 02 §13). No session or CSRF: authenticated by the provider's
// signature over the RAW body with this agency's secret. 2xx only after the event is stored.
// PROTECTED FILE (requirements/08 §8).
const MAX_BODY = 256 * 1024;

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/webhooks/[provider]/[agencyId]">,
) {
  await connection();
  const { provider, agencyId } = await ctx.params;
  const requestId = newRequestId();
  const headers = { "Cache-Control": "no-store", "X-Request-Id": requestId };
  // 04 §9: 300/min per provider + agency, fail-open (the signature is still required).
  const limited = await enforceRateLimit(
    { name: "webhook", limit: 300, windowSeconds: 60, failOpen: true },
    `${provider}:${agencyId}`,
  ).then(
    () => false,
    () => true,
  );
  if (limited)
    return new Response(null, { status: 429, headers: { ...headers, "Retry-After": "60" } });
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY) return new Response(null, { status: 413, headers });
  const raw = await request.text();
  if (raw.length > MAX_BODY) return new Response(null, { status: 413, headers });
  const outcome = await receiveWebhook(provider, agencyId, raw, request.headers, requestId);
  return Response.json(
    { received: outcome.result !== "invalid" },
    { status: outcome.status, headers },
  );
}
