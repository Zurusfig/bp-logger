import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { toBase64 } from "./image";

const client = new Anthropic();

export const OCR_MODEL = "claude-sonnet-4-6";

/** Below this confidence a reading goes to the review queue instead of saving clean. */
export const REVIEW_THRESHOLD = 0.9;

export type Reading = {
  orientation_deg: 0 | 90 | 180 | 270;
  observations: string;
  is_bp_display: boolean;
  sys: number | null;
  dia: number | null;
  pulse: number | null;
  irregular_flag: boolean | null;
  confidence: number;
};

export const PROMPT = `You are reading a photo of an Omron upper-arm blood pressure monitor's LCD screen.

LAYOUT
Three seven-segment numbers stacked vertically, labelled on the left of the screen:
  SYS   top, largest digits, typically 2-3 digits
  DIA   middle, medium digits, typically 2 digits
  PULSE bottom, smallest digits, typically 2 digits
A small heart-outline icon sits to the right of the DIA row when an irregular
heartbeat was detected. Other icons (cuff-fit indicator, movement indicator,
memory number) may appear elsewhere; ignore them.

IMAGE CONDITIONS
The photo may be rotated 90, 180 or 270 degrees. It may also be out of focus,
motion-blurred, underexposed, colour-cast (often pink or red), or partly covered by
a bright band of glare reflecting off the screen's clear plastic cover. Glare
typically appears as a near-white streak that can completely hide one or more rows
of digits.

ORIENTATION FIRST
Determine the orientation BEFORE reading any digit. Use the OMRON wordmark above the
screen, the START/STOP button below it, and the SYS / DIA / PULSE labels down the
left side of the screen to work out which way is up.

Seven-segment digits stay readable when the image is upside down but become
DIFFERENT digits: a rotated 6 resembles 9, 5 resembles 2, 116 can appear as 911.
Reading in the wrong orientation produces a plausible-looking but completely wrong
value, which is the worst possible outcome. If you cannot establish the orientation
with certainty, return null for every numeric field.

Once you have determined orientation_deg, mentally rotate the image by that amount
and read every digit from the CORRECTED view. Do not read digits from the image as
presented. If orientation_deg is not 0, re-check each digit against the corrected
orientation before reporting it, and confirm the value you report as SYS is the
number on the row labelled SYS in the corrected view.

CRITICAL RULES
- Never guess a digit. If a digit is covered by glare, cut off by the frame, or too
  blurred to be certain, return null for that ENTIRE field.
- A partly visible number is null. "Probably 5" is null. "5 or 6" is null.
- Returning null is always better than being wrong. There is no penalty for null.
- Do not infer a value from what is medically plausible. Report only what is visible.
- If the image is motion-blurred or out of focus, cap confidence at 0.7 even when you
  believe you have read the digits correctly. Blur causes single-segment misreads
  (66 read as 65, 8 read as 6) that feel certain but are not.
- If the image is not a blood pressure monitor display at all, set is_bp_display to
  false and return null for every numeric field.

OUTPUT
Return ONLY a JSON object with these keys IN THIS EXACT ORDER. No prose before or
after it, no markdown code fences.

{"orientation_deg":0|90|180|270,"observations":"MAX 30 WORDS: how you established orientation, and which digits are unreadable","is_bp_display":boolean,"sys":integer|null,"dia":integer|null,"pulse":integer|null,"irregular_flag":boolean|null,"confidence":number}

Fill orientation_deg and observations first and use them to think the image through
before you commit to any digit. orientation_deg is how many degrees clockwise the
image must be rotated to appear upright. confidence is 0.0-1.0 and reflects how
certain you are of the non-null values you returned.`;

async function callOnce(b64: string, mediaType: string): Promise<string> {
  const res = await client.messages.create({
    model: OCR_MODEL,
    max_tokens: 1000,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType as any, data: b64 },
          },
          { type: "text", text: PROMPT },
        ],
      },
    ],
  });

  const text = res.content
    .filter((c) => c.type === "text")
    .map((c) => (c as any).text)
    .join("");

  return extractJson(text);
}

/** Pull the first balanced {...} object out of the reply, ignoring any prose around it. */
function extractJson(text: string): string {
  const cleaned = text.replace(/```json/g, "").replace(/```/g, "");
  const start = cleaned.indexOf("{");
  if (start === -1) throw new Error(`no JSON found: ${cleaned.slice(0, 200)}`);

  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (c === "\\") {
      esc = true;
      continue;
    }
    if (c === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return cleaned.slice(start, i + 1);
  }
  throw new Error(`unbalanced JSON (likely truncated): ${cleaned.slice(start, start + 200)}`);
}

/** Single pass. Use readDisplayCorrected unless you specifically want one call. */
export async function readDisplay(
  b64: string,
  mediaType = "image/jpeg"
): Promise<Reading> {
  let last = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await callOnce(b64, mediaType);
      last = raw;
      return JSON.parse(raw) as Reading;
    } catch (e: any) {
      last = e.message ?? String(e);
    }
  }
  throw new Error(`unparseable response after 2 attempts: ${last.slice(0, 200)}`);
}

/**
 * Two-pass read. A rotated frame produces wrong digits even when the model names the
 * angle correctly, so: read once to get orientation_deg, physically rotate the image,
 * then read again from an upright view. Only rotated images cost a second call.
 */
export async function readDisplayCorrected(
  buf: Buffer,
  mediaType = "image/jpeg"
): Promise<Reading> {
  const first = await readDisplay(await toBase64(buf), mediaType);
  if (first.orientation_deg === 0 || !first.is_bp_display) return first;

  // The model's angle is unreliable, so read every rotation and take the best.
  const candidates = await Promise.all(
    [90, 180, 270].map(async (deg) => {
      const rotated = await sharp(buf).rotate(deg).toBuffer();
      return readDisplay(await toBase64(rotated), mediaType);
    })
  );

  const scored = [first, ...candidates]
    .filter((r) => r.is_bp_display && validate(r).ok)
    .sort((a, b) => {
      const filled = (r: Reading) =>
        [r.sys, r.dia, r.pulse].filter((v) => v !== null).length;
      return filled(b) - filled(a) || b.confidence - a.confidence;
    });

  if (scored.length === 0) return { ...first, sys: null, dia: null, pulse: null };

  // Agreement across orientations is the real confidence signal.
  const best = scored[0];
  const agree = scored.filter(
    (r) => r.sys === best.sys && r.dia === best.dia && r.pulse === best.pulse
  ).length;

  return {
    ...best,
    orientation_deg: first.orientation_deg,
    confidence: agree > 1 ? Math.min(best.confidence, 0.9) : 0.6,
  };
}

/** FR-3: reject impossible values before anything is saved. */
export function validate(r: Reading): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const { sys, dia, pulse } = r;

  if (sys !== null && (sys < 60 || sys > 260)) issues.push("sys out of range");
  if (dia !== null && (dia < 30 || dia > 160)) issues.push("dia out of range");
  if (pulse !== null && (pulse < 30 || pulse > 180)) issues.push("pulse out of range");

  if (sys !== null && dia !== null) {
    if (sys <= dia) issues.push("sys <= dia");
    else if (sys - dia <= 10) issues.push("gap <= 10");
  }

  return { ok: issues.length === 0, issues };
}

/** FR-3.4: anything unsure or incomplete goes to the review queue. */
export function needsReview(r: Reading): boolean {
  if (r.confidence < REVIEW_THRESHOLD) return true;
  if ([r.sys, r.dia, r.pulse].some((v) => v === null)) return true;
  return !validate(r).ok;
}