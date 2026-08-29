import sharp from "sharp";
import Anthropic from "@anthropic-ai/sdk";
import { toBase64 } from "./image";

const client = new Anthropic();

/** Cheap model used only to decide "is this a BP display?" before the real read. */
export const TRIAGE_MODEL = "claude-haiku-4-5-20251001";

/** Hard ceiling on OCR calls per group per day. Protects against photo dumps. */
export const DAILY_CALL_CAP = 50;

/**
 * Stage 1 — deterministic, free, and deliberately permissive.
 *
 * Measured against real photos from the family group: colour-saturation filtering is
 * NOT viable. Pink/colour-cast BP shots reach a channel spread of ~49, overlapping
 * ordinary photos, so any saturation threshold risks dropping a real reading. Aspect
 * ratio is equally useless — BP shots are plain 16:9/9:16 phone photos.
 *
 * So this stage only rejects shapes a BP photo can never have. Anything uncertain
 * passes through. A false negative here silently loses a reading; a false positive
 * costs a fraction of a cent.
 */
export async function couldBeBpPhoto(buf: Buffer): Promise<boolean> {
  const meta = await sharp(buf).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (!w || !h) return true; // unreadable metadata: let it through

  const ratio = w / h;

  // Panoramas and screenshots of wide windows. Real BP photos measured 0.56 and 1.78.
  if (ratio > 2.4 || ratio < 0.4) return false;

  // Too small to resolve seven-segment digits at all.
  if (Math.max(w, h) < 300) return false;

  // Animated content is never a monitor photo.
  if ((meta.pages ?? 1) > 1) return false;

  return true;
}

/**
 * Stage 2 — cheap-model triage. This is the actual cost control.
 *
 * A trip album of 10 photos costs 10 triage calls instead of 10 full reads, and only
 * the BP shots reach the expensive multi-pass pipeline. Unlike the pixel heuristics
 * above, this discriminates on content, so it is safe to act on.
 */
export async function isBpDisplay(buf: Buffer, mediaType = "image/jpeg"): Promise<boolean> {
  const res = await client.messages.create({
    model: TRIAGE_MODEL,
    max_tokens: 10,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType as any,
              data: await toBase64(buf),
            },
          },
          {
            type: "text",
            text: `Is there ANY chance this photo shows the LCD screen of a blood pressure monitor
or a similar small medical device with a digital number display?

The photo may be severely blurred, dark, rotated, colour-cast, or cut off at the edges
so that only part of the device is visible. Poor quality is EXPECTED and is never a
reason to answer NO.

Answer NO only if the subject is clearly something else entirely — a person, food, a
landscape, a screenshot, a shop shelf, a receipt, a document.

Answer YES if you see any small device with a screen, or if you cannot tell what the
subject is.

Answer with exactly one word: YES or NO.`,
          },
        ],
      },
    ],
  });

  const text = res.content
    .filter((c) => c.type === "text")
    .map((c) => (c as any).text)
    .join("")
    .trim()
    .toUpperCase();

  // Default to YES on anything unexpected — a wasted read beats a lost reading.
  return !text.startsWith("NO");
}
