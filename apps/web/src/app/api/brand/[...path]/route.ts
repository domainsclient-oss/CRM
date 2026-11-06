import { brandAssetResponse } from "@crm/core/branding/assets";

// Public brand assets (logos, favicons) — content-hashed, immutable, same-origin on every host
// (FR-BRAND-001). Only paths matching the stored-asset pattern are served.
export async function GET(_request: Request, ctx: RouteContext<"/api/brand/[...path]">) {
  const { path } = await ctx.params;
  return brandAssetResponse(path.join("/"));
}
