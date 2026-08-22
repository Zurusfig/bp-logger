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

/**
 * True when running inside LINE's own in-app browser (as opposed to a regular
 * mobile/desktop browser opened via a LIFF URL). That embedded WebView commonly
 * lacks window.print() and treats anchor `download`/data: URIs unreliably, so
 * features that depend on either need a different path there.
 */
export function isInLiffClient(): boolean {
  return _liff?.isInClient() ?? false;
}

/** Hands a URL to the device's real browser instead of LINE's in-app WebView. */
export function openExternally(url: string): void {
  _liff?.openWindow({ url, external: true });
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

    if (res.status === 401 && !sessionStorage.getItem("liff-retried")) {
    sessionStorage.setItem("liff-retried", "1");
    const mod = await import("@line/liff");
    mod.default.logout();
    mod.default.login();
    return new Promise<T>(() => {});
  }

    if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body.slice(0, 200)}`);
  }

  sessionStorage.removeItem("liff-retried");
  return (await res.json()) as T;
}