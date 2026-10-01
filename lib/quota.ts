import { getDb } from "./db";
import { alert } from "./alert";

/** LINE Free plan: 300 sends a month, counted per recipient (docs/decisions.md). */
export const MONTHLY_BUDGET = 300;

export type Tier = "sender" | "admin" | "summary" | "reminder";

/**
 * Minimum quota that must remain AFTER a claim for that tier to be allowed to
 * make it. Drop order, cheapest loss first (docs/decisions.md, "When the
 * quota runs low, reminders go first"): reminders stop at 60 remaining, admin
 * problem pushes at 40, the summary at 15, and the sender — who can fix a bad
 * read quickly — is the last thing to go, at 0.
 */
const TIER_FLOOR: Record<Tier, number> = {
  reminder: 60,
  admin: 40,
  summary: 15,
  sender: 0,
};

/**
 * What stops when a claim leaves exactly this many sends. A claim is allowed
 * while remaining > floor, so the claim that lands on a floor is that tier's
 * last one. Each `used` value comes back from exactly one claim, so each
 * crossing alerts exactly once a month.
 */
const CROSSING: Record<number, string> = {
  [TIER_FLOOR.reminder]: "reminders stop",
  [TIER_FLOOR.admin]: "instant admin pushes stop",
  [TIER_FLOOR.summary]: "the daily summary stops, sender messages only",
  [TIER_FLOOR.sender]: "every push stops, LIFF only until next month",
};

export type ClaimResult =
  | { claimed: true; used: number }
  | { claimed: false; used: number; exhausted: boolean };

/**
 * Atomically claims one send against this month's push_log row, gated by the
 * tier's reserve floor above. The increment and the floor check happen in one
 * database round trip (see claim_push() in the migration) so concurrent
 * claims — e.g. a household fan-out — can't race past the reserve.
 *
 * Never throws. A claim that can't be made (budget exhausted, or would drop
 * this tier below its floor) is a normal, expected outcome — "don't send" —
 * not an error. A DB error alerts and is treated the same way: fail closed.
 */
export async function claim(tier: Tier): Promise<ClaimResult> {
  const { data, error } = await getDb()
    .rpc("claim_push", { p_floor: TIER_FLOOR[tier], p_budget: MONTHLY_BUDGET })
    .single();

  if (error) {
    await alert("error", `quota claim failed: ${error.message}`);
    return { claimed: false, used: 0, exhausted: false };
  }

  const row = data as { claimed: boolean; used: number; exhausted: boolean };

  if (row.claimed) {
    const remaining = MONTHLY_BUDGET - row.used;
    const stops = CROSSING[remaining];
    if (stops) {
      await alert(
        remaining === 0 ? "error" : "warning",
        `push quota: ${remaining} of ${MONTHLY_BUDGET} left this month, ${stops}`
      );
    }
  }

  return row.claimed
    ? { claimed: true, used: row.used }
    : { claimed: false, used: row.used, exhausted: row.exhausted };
}

/** Drift at or above this many sends alerts; anything smaller the reserve absorbs. */
const DRIFT_ALERT = 10;

export type ReconcileResult = { previous: number; used: number };

/**
 * Overwrites this month's local count with LINE's (see reconcile_push() in
 * migration 0004). Raising the count can jump straight past a tier floor
 * without any claim landing on it, so crossings are checked here too.
 *
 * Returns null on a DB error, after alerting.
 */
export async function reconcile(lineUsed: number): Promise<ReconcileResult | null> {
  const { data, error } = await getDb()
    .rpc("reconcile_push", { p_used: lineUsed })
    .single();

  if (error) {
    await alert("error", `quota reconcile failed: ${error.message}`);
    return null;
  }

  const row = data as { prev_used: number; new_used: number };
  const before = MONTHLY_BUDGET - row.prev_used;
  const after = MONTHLY_BUDGET - row.new_used;

  for (const [floor, stops] of Object.entries(CROSSING)) {
    const f = Number(floor);
    if (before > f && after <= f) {
      await alert(
        f === 0 ? "error" : "warning",
        `push quota: ${after} of ${MONTHLY_BUDGET} left after syncing with LINE, ${stops}`
      );
    }
  }

  const drift = row.new_used - row.prev_used;
  if (Math.abs(drift) >= DRIFT_ALERT) {
    await alert(
      "warning",
      `push quota drifted by ${drift}: local ${row.prev_used}, LINE ${row.new_used}`
    );
  }

  return { previous: row.prev_used, used: row.new_used };
}

/**
 * Set on a 429 from LINE. Stops every further send this month regardless of
 * tier or remaining count, until next month's push_log row starts fresh. The
 * nightly cron reconciles the local count against LINE's real usage
 * (docs/decisions.md, "The quota is counted locally, not asked for on every send").
 *
 * Returns true when this call is the one that set the flag, so the caller
 * alerts once rather than once per 429. Anything other than an explicit false,
 * including a DB error or the 0002 version of the function that returns
 * nothing, counts as true: a duplicate alert beats a missing one.
 */
export async function markExhausted(): Promise<boolean> {
  const { data, error } = await getDb().rpc("mark_push_exhausted");
  if (error) {
    await alert("error", `failed to record quota exhaustion: ${error.message}`);
    return true;
  }
  return data !== false;
}
