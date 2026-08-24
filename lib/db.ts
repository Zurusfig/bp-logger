import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import crypto from "crypto";
import type { Reading } from "./ocr";
import type { SlotDef } from "./slot";

let _db: SupabaseClient | null = null;

/**
 * Lazy on purpose. Next.js collects page data at build time, which imports this
 * module before any env vars exist — constructing the client at module scope makes
 * the production build fail with "supabaseUrl is required".
 *
 * Server-side only: the service key bypasses RLS, so this must never be imported
 * into anything that ships to the client.
 */
export function getDb(): SupabaseClient {
  if (_db) return _db;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY not set");
  _db = createClient(url, key, { auth: { persistSession: false } });
  return _db;
}

export const BUCKET = "readings";

export function hashImage(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/** FR-9.2: a household exists as soon as the bot sees its group. */
export async function ensureHousehold(groupId: string): Promise<void> {
  await getDb().from("settings").upsert({ group_id: groupId }, { onConflict: "group_id" });
}

/** FR-9.2: anyone who posts is enrolled automatically — no join code. */
export async function ensureMember(
  groupId: string,
  userId: string,
  displayName?: string
): Promise<void> {
  await ensureHousehold(groupId);
  await getDb()
    .from("members")
    .upsert(
      {
        user_id: userId,
        group_id: groupId,
        ...(displayName ? { display_name: displayName } : {}),
      },
      { onConflict: "user_id" }
    );
}

/**
 * Known limitation: members.user_id is the primary key, so one LINE user can
 * belong to only one household at a time. ensureMember() upserts on that same
 * key, so someone enrolled in two allowed groups (e.g. a test group and the real
 * family group) just gets moved to whichever group they most recently posted or
 * opened LIFF in — this returns that group, not necessarily the one the caller
 * has in mind. A clean fix would drop the PK to (user_id, group_id) and store a
 * "current household" pointer for the 1:1-context lookup, but that's a schema
 * change and out of scope here.
 */
export async function memberGroup(userId: string): Promise<string | null> {
  const { data } = await getDb()
    .from("members")
    .select("group_id")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.group_id ?? null;
}

export type Member = {
  user_id: string;
  display_name: string | null;
  notify_ok: boolean;
  notify_all: boolean;
  notify_reminders: boolean;
};

/** Every member of a household, for the notification and reminder fan-out. */
export async function groupMembers(groupId: string): Promise<Member[]> {
  const { data } = await getDb()
    .from("members")
    .select("user_id,display_name,notify_ok,notify_all,notify_reminders")
    .eq("group_id", groupId);
  return (data as Member[]) ?? [];
}

/** The household's configured slots, for deriveSlot(). Null falls back to DEFAULT_SLOTS. */
export async function getSlots(groupId: string): Promise<SlotDef[] | null> {
  const { data } = await getDb()
    .from("settings")
    .select("slots")
    .eq("group_id", groupId)
    .maybeSingle();
  return (data?.slots as SlotDef[] | null) ?? null;
}

/** Push returned 403 — stop trying until they add the OA as a friend. */
export async function markUnreachable(userId: string): Promise<void> {
  await getDb().from("members").update({ notify_ok: false }).eq("user_id", userId);
}

/** FR-1.6: the same image posted twice. Two readings minutes apart are NOT duplicates. */
export async function findByHash(groupId: string, hash: string): Promise<string | null> {
  const { data } = await getDb()
    .from("readings")
    .select("id")
    .eq("group_id", groupId)
    .eq("image_hash", hash)
    .is("deleted_at", null)
    .maybeSingle();
  return data?.id ?? null;
}

export async function uploadImage(
  groupId: string,
  readingId: string,
  buf: Buffer,
  contentType = "image/jpeg"
): Promise<string> {
  const path = `${groupId}/${readingId}.jpg`;
  const { error } = await getDb()
    .storage.from(BUCKET)
    .upload(path, buf, { contentType, upsert: true });
  if (error) throw new Error(`storage upload failed: ${error.message}`);
  return path;
}

export async function signedImageUrl(path: string, seconds = 300): Promise<string | null> {
  const { data } = await getDb().storage.from(BUCKET).createSignedUrl(path, seconds);
  return data?.signedUrl ?? null;
}

export async function insertReading(row: {
  groupId: string;
  senderId: string;
  takenAt: Date;
  postedAt: Date;
  slot: string;
  readingDate: string;
  reading?: Reading | null;
  sys?: number | null;
  dia?: number | null;
  pulse?: number | null;
  source?: string;
  imageHash?: string | null;
  imagePath?: string | null;
  needsReview: boolean;
  reviewNote?: string | null;
}): Promise<string> {
  const r = row.reading;
  const { data, error } = await getDb()
    .from("readings")
    .insert({
      group_id: row.groupId,
      sender_id: row.senderId,
      taken_at: row.takenAt.toISOString(),
      posted_at: row.postedAt.toISOString(),
      slot: row.slot,
      reading_date: row.readingDate,
      sys: r?.sys ?? row.sys ?? null,
      dia: r?.dia ?? row.dia ?? null,
      pulse: r?.pulse ?? row.pulse ?? null,
      irregular_flag: r?.irregular_flag ?? null,
      source: row.source ?? "image",
      image_hash: row.imageHash ?? null,
      image_path: row.imagePath ?? null,
      ocr_raw: r ?? null,
      confidence: r?.confidence ?? null,
      needs_review: row.needsReview,
      review_note: row.reviewNote ?? null,
    })
    .select("id")
    .single();

  if (error) throw new Error(`insert failed: ${error.message}`);
  return data.id as string;
}

export async function setImagePath(id: string, path: string): Promise<void> {
  await getDb().from("readings").update({ image_path: path }).eq("id", id);
}

export type CompleteResult = {
  sys: number | null;
  dia: number | null;
  pulse: number | null;
  /** True when this fill left no field null, i.e. the reading is now complete. */
  completed: boolean;
};

/** Fill the fields a failed OCR left null, from numbers the sender typed. */
export async function completeReading(
  id: string,
  vals: Record<string, number>,
  byUserId: string
): Promise<CompleteResult> {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    ...vals,
    source: "image+text",
    edited_by: byUserId,
    edited_at: now,
  };

  const { data } = await getDb().from("readings").select("sys,dia,pulse").eq("id", id).single();
  const merged = { ...data, ...vals } as Record<string, number | null>;
  const completed = merged.sys != null && merged.dia != null && merged.pulse != null;

  if (completed) {
    patch.needs_review = false;
    patch.reviewed_by = byUserId;
    patch.reviewed_at = now;
  }

  await getDb().from("readings").update(patch).eq("id", id);

  return { sys: merged.sys ?? null, dia: merged.dia ?? null, pulse: merged.pulse ?? null, completed };
}

// ------------------------------------------------------------------ pending

export async function setPending(
  userId: string,
  readingId: string,
  missing: string[],
  minutes = 30
): Promise<void> {
  await getDb().from("pending").upsert({
    user_id: userId,
    reading_id: readingId,
    missing,
    expires_at: new Date(Date.now() + minutes * 60_000).toISOString(),
  });
}

export async function getPending(
  userId: string
): Promise<{ reading_id: string; missing: string[] } | null> {
  const { data } = await getDb()
    .from("pending")
    .select("reading_id,missing,expires_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) return null;
  if (new Date(data.expires_at) < new Date()) {
    await clearPending(userId);
    return null;
  }
  return { reading_id: data.reading_id, missing: data.missing };
}

export async function clearPending(userId: string): Promise<void> {
  await getDb().from("pending").delete().eq("user_id", userId);
}

// -------------------------------------------------------------------- usage

/** Returns today's OCR call count after adding this one. Backs the daily cap. */
export async function bumpUsage(groupId: string, ocr = 0, triage = 0): Promise<number> {
  const { data, error } = await getDb().rpc("bump_usage", { g: groupId, ocr, triage });
  if (error) return 0; // accounting must never block a reading
  return (data as number) ?? 0;
}

// ---------------------------------------------------------------------------
// M5: append to lib/db.ts
// ---------------------------------------------------------------------------
 
/**
 * The sender's most recent reading within the last N minutes, used when someone
 * types three numbers to correct a value the OCR got wrong.
 */
export async function recentReadingBySender(
  senderId: string,
  minutes = 60
): Promise<string | null> {
  const since = new Date(Date.now() - minutes * 60_000).toISOString();
 
  const { data } = await getDb()
    .from("readings")
    .select("id")
    .eq("sender_id", senderId)
    .is("deleted_at", null)
    .gte("posted_at", since)
    .order("posted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
 
  return data?.id ?? null;
}
 
/**
 * completeReading currently only fills nulls in practice. For M5 it must also
 * overwrite existing values, so make sure its update applies every key in `vals`
 * rather than skipping ones that already have a value. The version shipped in M3
 * already does this — no change needed, this note is here so future edits keep it.
 */

// ------------------------------------------------------------- reminders cron

export type HouseholdSettings = {
  group_id: string;
  tz: string;
  slots: SlotDef[] | null;
};

/** Every household's settings row, for the reminder cron to scan. */
export async function allSettings(): Promise<HouseholdSettings[]> {
  const { data } = await getDb().from("settings").select("group_id,tz,slots");
  return (data as HouseholdSettings[]) ?? [];
}

/** Whether a group has logged anything at all recently — inactive households don't get chased. */
export async function hasRecentReadings(groupId: string, sinceIso: string): Promise<boolean> {
  const { data } = await getDb()
    .from("readings")
    .select("id")
    .eq("group_id", groupId)
    .is("deleted_at", null)
    .gte("posted_at", sinceIso)
    .limit(1)
    .maybeSingle();
  return !!data;
}

/** Slot keys already logged for a given household and local date. */
export async function loggedSlots(groupId: string, readingDate: string): Promise<Set<string>> {
  const { data } = await getDb()
    .from("readings")
    .select("slot")
    .eq("group_id", groupId)
    .eq("reading_date", readingDate)
    .is("deleted_at", null);
  return new Set((data ?? []).map((r: { slot: string }) => r.slot));
}

/**
 * Records that a (group, date, slot) reminder is going out, before the push is
 * sent. Slots already recorded — by an earlier run today, or a duplicate
 * invocation of this one — hit the primary key and are dropped silently; only
 * the slot keys newly recorded here come back, so the caller knows exactly what
 * is safe to mention in the message.
 */
export async function recordReminders(
  groupId: string,
  readingDate: string,
  slotKeys: string[]
): Promise<string[]> {
  if (slotKeys.length === 0) return [];

  const rows = slotKeys.map((slot_key) => ({
    group_id: groupId,
    reading_date: readingDate,
    slot_key,
  }));

  const { data, error } = await getDb()
    .from("reminders_sent")
    .upsert(rows, { onConflict: "group_id,reading_date,slot_key", ignoreDuplicates: true })
    .select("slot_key");

  if (error) {
    console.error("reminders_sent insert failed", { groupId, readingDate, err: error.message });
    return [];
  }
  return (data ?? []).map((r: { slot_key: string }) => r.slot_key);
}
