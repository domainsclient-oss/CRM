import { connection } from "next/server";
import { getDb } from "@crm/core/firebase-admin";
import { logger } from "@crm/core/logger";
import { newRequestId } from "@crm/core/request-id";

// Liveness + Firestore connectivity probe for uptime checks (requirements/10 §10).
// Public endpoint: returns status only — never project IDs, errors, or data.
export async function GET() {
  // Always run at request time; never prerender or cache this probe.
  await connection();

  const requestId = newRequestId();
  const headers = { "Cache-Control": "no-store", "X-Request-Id": requestId };
  try {
    await getDb().listCollections();
    return Response.json({ status: "ok", firestore: "ok" }, { headers });
  } catch (error) {
    logger.error("health.firestore_unreachable", { requestId, route: "/api/health", error });
    return Response.json({ status: "degraded", firestore: "error" }, { status: 503, headers });
  }
}
