import { memberGroup, ensureMember } from "./db";

/**
 * Verifies a LIFF ID token with LINE and returns the LINE user id.
 *
 * The token comes from the browser, so it is untrusted until LINE confirms it.
 * Verifying server-side is what stops anyone from calling the API with a made-up
 * user id and reading another household's readings.
 */
export async function verifyIdToken(idToken: string): Promise<string | null> {
  const channelId = process.env.LINE_LOGIN_CHANNEL_ID;
  if (!channelId) throw new Error("LINE_LOGIN_CHANNEL_ID not set");

  const res = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
  });

  if (!res.ok) {
    console.warn("id token verify failed", res.status, await res.text());
    return null;
  }

  const claims = (await res.json()) as { sub?: string; aud?: string; exp?: number };

  // LINE already checks these, but a mismatched audience means the token was minted
  // for a different channel and must not be trusted here.
  if (!claims.sub) return null;
  if (claims.aud !== channelId) return null;

  return claims.sub;
}

export type Session = { userId: string; groupId: string; displayName?: string };

/**
 * FR-9.3: resolve which household this user belongs to.
 *
 * In a group context LIFF gives us the groupId directly. Opened 1:1 it does not,
 * so we look the user up in members — which is why enrollment happens on first post.
 */
export async function resolveSession(
  idToken: string,
  contextGroupId?: string,
  displayName?: string
): Promise<Session | null> {
  const userId = await verifyIdToken(idToken);
  if (!userId) return null;

  const allowed = process.env.ALLOWED_GROUP_ID;

  if (contextGroupId) {
    if (allowed && contextGroupId !== allowed) return null;
    // Opened from inside the group: enrol them so they stay reachable afterwards.
    await ensureMember(contextGroupId, userId, displayName);
    return { userId, groupId: contextGroupId, displayName };
  }

  const groupId = await memberGroup(userId);
  if (!groupId) return null; // not a member of any household yet
  if (allowed && groupId !== allowed) return null;

  return { userId, groupId, displayName };
}

/** Pulls the bearer token from an API request and resolves the session. */
export async function sessionFromRequest(req: Request): Promise<Session | null> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;

  const idToken = auth.slice(7);
  const groupId = req.headers.get("x-line-group-id") ?? undefined;

  return resolveSession(idToken, groupId);
}