import crypto from "crypto";

export function verifySignature(body: string, signature: string | null): boolean {
  if (!signature) return false;
  const hash = crypto
    .createHmac("sha256", process.env.LINE_CHANNEL_SECRET!)
    .update(body)
    .digest("base64");
  // timing-safe compare; lengths must match first
  const a = Buffer.from(hash);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}