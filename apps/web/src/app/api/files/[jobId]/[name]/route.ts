import { handleFileDownload } from "@crm/core/data-http";

// Authenticated download of job output (exports, import error reports) from the private bucket.
// Requester or workspace admins only; files expire 24 h after the job finishes. PROTECTED FILE.
export async function GET(request: Request, ctx: RouteContext<"/api/files/[jobId]/[name]">) {
  const { jobId, name } = await ctx.params;
  return handleFileDownload(request, jobId, name);
}
