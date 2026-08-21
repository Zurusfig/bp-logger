"use client";

import type { Liff } from "@line/liff";

export type LiffSession = {
  idToken: string;
  groupId?: string;
  displayName?: string;
};

let _liff: Liff | null = null;

/**
 * Initialises LIFF and returns what the API needs: a verifiable ID token, plus the
 * group id when the app was opened from inside the group chat.
 *
 * Kept out of the table components on purpose — they take plain data as props so the
 * same components can be mounted behind LINE Login in a browser (M4.5).
 */
export async function initLiff(): Promise<LiffSession> {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  if (!liffId) throw new Error("NEXT_PUBLIC_LIFF_ID not set");

  if (!_liff) {
    const mod = await import("@line/liff");
    _liff = mod.default;
    await _liff.init({ liffId });
  }

  if (!_liff.isLoggedIn()) {
    _liff.login();
    // login() navigates away; nothing after this runs
    return new Promise<LiffSession>(() => {});
  }

  const idToken = _liff.getIDToken();
  if (!idToken) throw new Error("no ID token — check that the openid scope is enabled");

  const ctx = _liff.getContext();
  const groupId = ctx?.type === "group" ? ctx.groupId : undefined;

  let displayName: string | undefined;
  try {
    displayName = (await _liff.getProfile()).displayName;
  } catch {
    // profile scope may be unavailable; not fatal
  }

  return { idToken, groupId, displayName };
}

/** Authenticated fetch against our own API. */
export async function apiFetch<T>(
  path: string,
  session: LiffSession,
  init: RequestInit = {}
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${session.idToken}`,
      ...(session.groupId ? { "x-line-group-id": session.groupId } : {}),
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}