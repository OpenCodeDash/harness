import { createHash } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_MAX_BYTES = 15 * 1024 * 1024;

export interface CachedImage {
  hash: string;
  path: string;
  mimeType: string;
}

export function hashBuffer(buffer: Uint8Array): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function mimeFor(url: string, contentType?: string | null): string {
  const header = contentType?.split(";")[0]?.trim().toLowerCase();
  if (header?.startsWith("image/")) return header;
  const path = url.split("?")[0]?.toLowerCase() ?? "";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

export async function cacheImage(input: {
  url: string;
  dir: string;
  fetchImpl?: typeof fetch;
  maxBytes?: number;
}): Promise<CachedImage> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(input.url);
  if (!response.ok) {
    throw new Error(`image fetch ${response.status}: ${input.url}`);
  }
  const contentType = response.headers.get("content-type");
  if (contentType && !contentType.startsWith("image/")) {
    throw new Error(`not an image (${contentType}): ${input.url}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
  if (buffer.byteLength > maxBytes) {
    throw new Error(`image too large (${buffer.byteLength} bytes): ${input.url}`);
  }

  const hash = hashBuffer(buffer);
  const mimeType = mimeFor(input.url, contentType);
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1] ?? "img";
  const path = join(input.dir, `${hash}.${extension}`);

  await mkdir(input.dir, { recursive: true });
  try {
    await access(path);
  } catch {
    await writeFile(path, buffer);
  }
  return { hash, path, mimeType };
}
