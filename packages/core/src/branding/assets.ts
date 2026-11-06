import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import {
  BRAND_ASSET_LIMITS,
  BRAND_ASSET_PATH,
  type BrandAssetKind,
} from "@crm/shared/branding/schemas";
import { ValidationError } from "../errors";
import { getBrandBucket } from "../firebase-admin";

// Secure upload pipeline (FR-BRAND-001 AC1–2, NFR-SEC-009): the file type comes from the bytes
// (sharp's decoder), never from the name or the client's MIME type; SVG and animated images are
// refused; images are decoded and re-encoded (which drops EXIF/ICC/XMP metadata and any trailing
// payload) and stored under a content-hash name.

const EXT = { png: "png", jpeg: "jpg", webp: "webp" } as const;
const CONTENT_TYPE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};

const invalid = (message: string) => new ValidationError({ file: [message] }, "invalid_upload");

export interface StoredAsset {
  path: string;
  width: number;
  height: number;
  bytes: number;
}

export async function storeBrandAsset(
  scope: { kind: "agency"; id: string } | { kind: "tenant"; id: string },
  kind: BrandAssetKind | "avatar",
  input: Uint8Array,
): Promise<StoredAsset> {
  const limits = BRAND_ASSET_LIMITS[kind];
  if (input.byteLength === 0) throw invalid("Choose a file");
  if (input.byteLength > limits.maxBytes) {
    throw invalid(`The file is larger than ${Math.round(limits.maxBytes / 1024)} KB`);
  }

  let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    meta = await sharp(input, { failOn: "error", limitInputPixels: 2048 * 2048 * 4 }).metadata();
  } catch {
    throw invalid("This file isn't a supported image");
  }
  const format = meta.format as string | undefined;
  if (!format || !(limits.types as readonly string[]).includes(format)) {
    throw invalid(
      `Use ${limits.types.map((t) => t.toUpperCase()).join(", ")} (SVG isn't accepted)`,
    );
  }
  if ((meta.pages ?? 1) > 1) throw invalid("Animated images aren't accepted");
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height || width > limits.maxSide || height > limits.maxSide) {
    throw invalid(`Images can be at most ${limits.maxSide}×${limits.maxSide} pixels`);
  }

  const pipeline = sharp(input, { failOn: "error" }).rotate(); // apply EXIF orientation, then drop it
  const output =
    format === "png"
      ? await pipeline.png({ compressionLevel: 9 }).toBuffer()
      : format === "jpeg"
        ? await pipeline.jpeg({ quality: 85, mozjpeg: true }).toBuffer()
        : await pipeline.webp({ quality: 85 }).toBuffer();

  const ext = EXT[format as keyof typeof EXT];
  const hash = createHash("sha256").update(output).digest("hex");
  const path = `${scope.kind}_${scope.id}/${hash}.${ext}`;
  if (!BRAND_ASSET_PATH.test(path)) throw invalid("Invalid upload target");

  const file = getBrandBucket().file(path);
  const [exists] = await file.exists();
  if (!exists) {
    await file.save(output, {
      resumable: false,
      contentType: CONTENT_TYPE[ext]!,
      metadata: { cacheControl: "public, max-age=31536000, immutable" },
    });
  }
  return { path, width, height, bytes: output.byteLength };
}

/** Read a stored asset for the /api/brand route; null for anything not matching the pattern. */
export async function readBrandAsset(
  path: string,
): Promise<{ body: Buffer; contentType: string } | null> {
  if (!BRAND_ASSET_PATH.test(path)) return null;
  const file = getBrandBucket().file(path);
  try {
    const [body] = await file.download();
    return { body, contentType: CONTENT_TYPE[path.split(".").pop()!]! };
  } catch {
    return null;
  }
}

/** Shared route handler body for `/api/brand/[...path]` in each app. */
export async function brandAssetResponse(path: string): Promise<Response> {
  const asset = await readBrandAsset(path);
  if (!asset) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(asset.body), {
    headers: {
      "Content-Type": asset.contentType,
      // Content-hashed names never change: cache forever.
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "same-site",
    },
  });
}
