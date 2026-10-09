import { connection } from "next/server";
import { getDb } from "@crm/core/firebase-admin";

// Liveness + Firestore connectivity probe for uptime checks (requirements/10 §10).
// Public endpoint: returns status only — never project IDs, errors, or data.
export async function GET() {
  // Always run at request time; never prerender or cache this probe.
  await connection();

  const headers = { "Cache-Control": "no-store" };
  try {
    await getDb().listCollections();
    return Response.json({ status: "ok", firestore: "ok" }, { headers });
  } catch (error) {
    const err = error as { code?: unknown; message?: unknown };
    console.error(
      JSON.stringify({
        severity: "ERROR",
        message: "health.firestore_unreachable",
        code: err.code ?? null,
        detail: typeof err.message === "string" ? err.message.slice(0, 200) : null,
      }),
    );
    return Response.json({ status: "degraded", firestore: "error" }, { status: 503, headers });
  }
}
