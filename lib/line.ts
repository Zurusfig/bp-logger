import crypto from "crypto";

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

/**
 * FR-5.3: always 1:1, never the group. Throws PushForbidden when the user has not
 * added the OA as a friend, so the caller can mark them unreachable and stay silent.
 */
export async function pushMessage(userId: string, text: string): Promise<void> {
  const res = await fetch(`${API}/message/push`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ to: userId, messages: [{ type: "text", text }] }),
  });

  if (res.status === 403) throw new PushForbidden(await res.text());
  if (!res.ok) throw new Error(`push failed ${res.status}: ${await res.text()}`);
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
};