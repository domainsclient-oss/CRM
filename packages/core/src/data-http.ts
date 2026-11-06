import "server-only";
import { HTTP_STATUS, fail, ok } from "@crm/shared/errors";
import { isSameOrigin, normalizeHost } from "@crm/shared/hosts";
import { IMPORT_LIMITS } from "@crm/shared/import";
import { assertWorkspaceState } from "./actions/wrappers";
import { authorize } from "./authz";
import { requireTenantContext, type TenantContext } from "./contexts/tenant-context";
import { AppError, toActionError } from "./errors";
import { getPrivateBucket } from "./firebase-admin";
import { getJobFile } from "./jobs/runner";
import { storeImportUpload } from "./jobs/imports";
import { POLICIES, enforceRateLimit } from "./rate-limit";
import { newRequestId } from "./request-id";
import { sessionPolicy } from "./session";
import { CSRF_HEADER } from "./session-http";

// Route Handlers for files (FR-IMP-001/002): CSV upload (too large for a Server Action body) and
// authenticated downloads of job output from the private bucket. Same session + membership
// checks as every action; uploads also require the CSRF header and a same-origin Origin.

function cookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

async function contextFrom(request: Request, requestId: string): Promise<TenantContext> {
  const host = normalizeHost(request.headers.get("host"));
  if (!host) throw new AppError("NOT_FOUND", "bad_host");
  const proto = request.headers.get("x-forwarded-proto");
  const secure = proto ? proto === "https" : !host.includes("localhost");
  return requireTenantContext({
    host,
    sessionCookie: cookie(request, sessionPolicy("workspace", secure).cookieName),
    requestId,
  });
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  });

export async function handleImportUpload(request: Request): Promise<Response> {
  const requestId = newRequestId();
  try {
    const host = normalizeHost(request.headers.get("host"));
    if (
      !host ||
      request.headers.get(CSRF_HEADER) !== "1" ||
      !isSameOrigin(request.headers.get("origin"), host)
    ) {
      throw new AppError("FORBIDDEN", "csrf");
    }
    // A declared length is required, so oversized bodies are refused before being buffered.
    const declared = request.headers.get("content-length");
    const length = declared === null ? Number.NaN : Number(declared);
    if (!Number.isFinite(length)) {
      throw new AppError("VALIDATION", "length_required", { file: ["Choose a CSV file"] });
    }
    if (length > IMPORT_LIMITS.maxBytes + 64 * 1024) {
      throw new AppError("VALIDATION", "too_large", { file: ["The file is larger than 10 MB"] });
    }
    const ctx = await contextFrom(request, requestId);
    authorize(ctx, "import.run");
    await assertWorkspaceState(ctx, "imports.upload", "import.run");
    await enforceRateLimit(POLICIES.importUploadByUser, ctx.uid);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File))
      throw new AppError("VALIDATION", "no_file", { file: ["Choose a CSV file"] });
    const bytes = new Uint8Array(await file.arrayBuffer());
    return json(ok(await storeImportUpload(ctx, bytes)));
  } catch (error) {
    const err = toActionError(error, requestId);
    return json(fail(err), HTTP_STATUS[err.code]);
  }
}

export async function handleFileDownload(
  request: Request,
  jobId: string,
  name: string,
): Promise<Response> {
  const requestId = newRequestId();
  try {
    const ctx = await contextFrom(request, requestId);
    await enforceRateLimit(POLICIES.fileDownloadByUser, ctx.uid);
    const file = await getJobFile(ctx, jobId, name);
    const [body] = await getPrivateBucket().file(file.path).download();
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${file.name.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    const err = toActionError(error, requestId);
    return new Response(err.message, {
      status: HTTP_STATUS[err.code],
      headers: { "Cache-Control": "no-store" },
    });
  }
}
