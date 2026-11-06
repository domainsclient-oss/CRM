import { ImageResponse } from "next/og";
import { HOME, PRODUCT } from "@crm/shared/content/marketing";

// Shared Open Graph image for marketing pages (07 §2): 1200×630 PNG, generated at build time.
// A plain route (not the opengraph-image file convention) so the URL is stable and only
// marketing pages reference it.
export const dynamic = "force-static";

export function GET() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: 80,
        background: "#0a0a0a",
        color: "#fafafa",
      }}
    >
      <div style={{ fontSize: 96, fontWeight: 700 }}>{PRODUCT}</div>
      <div style={{ fontSize: 40, marginTop: 24, color: "#d4d4d4", lineHeight: 1.3 }}>
        {HOME.lead}
      </div>
    </div>,
    { width: 1200, height: 630 },
  );
}
