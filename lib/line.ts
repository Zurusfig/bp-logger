import crypto from "crypto";
import { alert } from "./alert";
import { claim, markExhausted, type Tier } from "./quota";

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

export type PushResult =
  | { ok: true }
  | { ok: false; reason: "quota" }
  | { ok: false; reason: "error"; status: number };

/**
 * FR-5.3: always 1:1, never the group. Throws PushForbidden when the user has not
 * added the OA as a friend, so the caller can mark them unreachable and stay silent
 * — unchanged from before (docs/decisions.md, "Alerts never go over LINE").
 *
 * Every send claims one message against the monthly budget first, at the given
 * tier's reserve (lib/quota.ts). A refused claim is a normal "don't send", not an
 * error: it returns reason "quota" without calling LINE. Taking the tier here
 * rather than at each call site means no send path can skip the budget.
 *
 * Every other outcome is returned as a typed result instead of thrown. A 429 means
 * the monthly quota is gone: it's recorded so every further send fails closed until
 * next month, and it alerts. Anything else unexpected also alerts — a 403 is the
 * only push failure that isn't itself a problem worth paging the admin about.
 *
 * PUSH_DRY_RUN=true logs the message instead of calling LINE at all, for testing
 * the quota/alerting plumbing without spending real sends. The claim still runs,
 * so a dry run does count against push_log.
 */
export async function pushMessage(
  userId: string,
  text: string,
  tier: Tier
): Promise<PushResult> {
  const claimed = await claim(tier);
  if (!claimed.claimed) {
    console.warn("push skipped, quota", { userId, tier, used: claimed.used });
    return { ok: false, reason: "quota" };
  }

  if (process.env.PUSH_DRY_RUN === "true") {
    console.log("push (dry run)", { userId, tier, text });
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
    return { ok: false, reason: "error", status: 0 };
  }

  if (res.ok) return { ok: true };
  if (res.status === 403) throw new PushForbidden(await res.text());

  if (res.status === 429) {
    // LINE ran out before the local count did, so the count has drifted. Worth
    // knowing even though tier alerts exist, but once, not per request.
    const body = await res.text();
    if (await markExhausted()) {
      await alert("warning", `LINE push quota exhausted (429): ${body}`);
    }
    return { ok: false, reason: "error", status: 429 };
  }

  await alert("error", `push failed ${res.status}: ${await res.text()}`);
  return { ok: false, reason: "error", status: res.status };
}

/**
 * Answers in the 1:1 chat an event came from with a free reply, falling back to
 * a push (docs/decisions.md, "Reply first in a 1:1 chat, push only as fallback").
 * Never pass a token from a group event: the reply would land in the group.
 *
 * A reply token expires after about 60 seconds and can be used once. A missing
 * or expired token, or any failed reply, falls through to pushMessage, so the
 * caller gets the same PushResult and PushForbidden contract either way. A
 * failed reply doesn't alert: an expired token is expected on a slow OCR read.
 */
export async function replyOrPush(
  replyToken: string | undefined,
  userId: string,
  text: string,
  tier: Tier
): Promise<PushResult> {
  if (replyToken) {
    if (process.env.PUSH_DRY_RUN === "true") {
      console.log("reply (dry run)", { userId, text });
      return { ok: true };
    }

    try {
      const res = await fetch(`${API}/message/reply`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
      });
      if (res.ok) return { ok: true };
      console.warn("reply failed, pushing instead", {
        userId,
        status: res.status,
        body: await res.text(),
      });
    } catch (err) {
      console.warn("reply failed, pushing instead", { userId, err: String(err) });
    }
  }

  return pushMessage(userId, text, tier);
}

/** Messages LINE has counted against this month's quota. Replies are not counted. */
export async function getQuotaConsumption(): Promise<number> {
  const res = await fetch(`${API}/message/quota/consumption`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`quota consumption failed ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { totalUsage: number };
  return body.totalUsage;
}

/** This month's sending limit, or null when the channel has none set. */
export async function getQuotaLimit(): Promise<number | null> {
  const res = await fetch(`${API}/message/quota`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`quota limit failed ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { type: "none" | "limited"; value?: number };
  return body.type === "limited" ? (body.value ?? null) : null;
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