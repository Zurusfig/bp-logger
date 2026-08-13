import sharp from "sharp";

/** Downscale so the base64 payload stays well under the API's 10 MB limit. */
export async function toBase64(buf: Buffer): Promise<string> {
  const out = await sharp(buf)
    .rotate()                                    // apply EXIF orientation if present
    .resize({ width: 1568, withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  return out.toString("base64");
}