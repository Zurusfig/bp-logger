import { waitUntil } from "@vercel/functions";
import { verifySignature, type LineEvent } from "@/lib/line";
import { processEvents } from "@/lib/worker";

export const runtime = "nodejs";
export const maxDuration = 60; // OCR can make up to 4 calls on a rotated image

export async function POST(req: Request) {
  // Raw body: the signature is an HMAC over exactly these bytes. Parsing first and
  // re-stringifying produces different bytes and fails verification every time.
  const body = await req.text();
  const sig = req.headers.get("x-line-signature");

  if (!verifySignature(body, sig)) {
    console.warn("bad signature");
    return new Response("unauthorized", { status: 401 });
  }

  const { events } = JSON.parse(body) as { events: LineEvent[] };

  // NFR-1: LINE needs a fast 200 or it retries. waitUntil keeps the function alive
  // after the response is sent, so OCR runs without blocking the acknowledgement.
  waitUntil(
    processEvents(events).catch((err) => console.error("worker failed", String(err)))
  );

  return new Response(null, { status: 200 });
}