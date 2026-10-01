import crypto from "crypto";
import { alert } from "./alert";
import { markExhausted } from "./quota";

const API = "https://api.line.me/v2/bot";
const DATA_API = "https://api-data.line.me/v2/bot";

function authHeaders() {
  return {
    Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN!}`,
  };
}

export function verifySignature(body: string, signature: string | null): boolean {
  if (!signature) return false;
  const hash = crypto
    .createHmac("sha256", process.env.LINE_CHANNEL_SECRET!)
    .update(body)
    .digest("base64");
  const a = Buffer.from(hash);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Image bytes for a message. LINE keeps content only briefly, so this must run in
 * the worker immediately — never deferred or retried much later.
 */
export async function getMessageContent(messageId: string): Promise<Buffer> {
  const res = await fetch(`${DATA_API}/message/${messageId}/content`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`content fetch failed ${res.status}: ${await res.text()}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

export class PushForbidden extends Error {}

export type PushResult = { ok: true } | { ok: false; status: number };

/**
 * FR-5.3: always 1:1, never the group. Throws PushForbidden when the user has not
 * added the OA as a friend, so the caller can mark them unreachable and stay silent
 * — unchanged from before (docs/decisions.md, "Alerts never go over LINE").
 *
 * Every other outcome is returned as a typed result instead of thrown. A 429 means
 * the monthly quota is gone: it's recorded so every further send fails closed until
 * next month, and it alerts. Anything else unexpected also alerts — a 403 is the
 * only push failure that isn't itself a problem worth paging the admin about.
 *
 * PUSH_DRY_RUN=true logs the message instead of calling LINE at all, for testing
 * the quota/alerting plumbing without spending real sends.
 */
export async function pushMessage(userId: string, text: string): Promise<PushResult> {
  if (process.env.PUSH_DRY_RUN === "true") {
    console.log("push (dry run)", { userId, text });
    return { ok: true };
  }

  let res: Response;
  try {
    res = await fetch(`${API}/message/push`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ to: userId, messages: [{ type: "text", text }] }),
    });
  } catch (err) {
    await alert("error", `push request failed: ${String(err)}`);
    return { ok: false, status: 0 };
  }

  if (res.ok) return { ok: true };
  if (res.status === 403) throw new PushForbidden(await res.text());

  if (res.status === 429) {
    await markExhausted();
    await alert("warning", `LINE push quota exhausted (429): ${await res.text()}`);
    return { ok: false, status: 429 };
  }

  await alert("error", `push failed ${res.status}: ${await res.text()}`);
  return { ok: false, status: res.status };
}

export async function getGroupMemberName(
  groupId: string,
  userId: string
): Promise<string | undefined> {
  const res = await fetch(`${API}/group/${groupId}/member/${userId}`, {
    headers: authHeaders(),
  });
  if (!res.ok) return undefined;
  const json = (await res.json()) as { displayName?: string };
  return json.displayName;
}

// ------------------------------------------------------------------ event types

export type LineSource = {
  type: "user" | "group" | "room";
  userId?: string;
  groupId?: string;
  roomId?: string;
};

export type LineEvent = {
  type: string;
  timestamp: number;
  source: LineSource;
  replyToken?: string;
  message?: { id: string; type: string; text?: string };
  /** Present on memberJoined events: everyone who just joined the group. */
  joined?: { members: { userId?: string }[] };
};