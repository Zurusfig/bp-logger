import { isAllowedGroup } from "@/lib/groups";
import {
  allSettings,
  dayCounts,
  groupMembers,
  hasRecentReadings,
  loggedSlots,
  markUnreachable,
  recordReminders,
  type HouseholdSettings,
} from "@/lib/db";
import { pushMessage, PushForbidden } from "@/lib/line";
import { msgDailySummary, msgMissedEntry } from "@/lib/messages";
import { DEFAULT_SLOTS, localParts, minutes, normalise } from "@/lib/slot";

export const runtime = "nodejs";
export const maxDuration = 60;

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Reserved key in reminders_sent marking the day's summary as sent. Slot keys
 * never start with an underscore in practice, so it can't collide with one.
 */
const SUMMARY_KEY = "_summary";

type HouseholdResult = {
  group_id: string;
  skipped?: "inactive";
  due: number;
  sent: number;
  failed: number;
};

type SummaryResult =
  | { skipped: "no_admin" | "already_sent" }
  | { logged: number; flagged: number; missing: number; sent: number; failed: number };

/**
 * Fired by one Vercel Hobby cron entry (22:00 Bangkok, see vercel.json). It
 * doesn't rely on that — it works out from the data what's due right now,
 * which is what makes repeated or overlapping invocations harmless.
 *
 * Every run sends each household's daily summary to its admins
 * (docs/decisions.md, "One cron entry, and it reports rather than reminds").
 * Missed-slot reminders run too, but only when turned on.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // Off unless explicitly turned on (docs/decisions.md, "Reminders are a
  // checklist, not a health warning"). Defaulting to off means a missing env
  // var can't quietly start spending quota again.
  const remindersOn = process.env.REMINDERS_ENABLED === "true";

  const settings = (await allSettings()).filter((s) => isAllowedGroup(s.group_id));
  const households = await Promise.all(
    settings.map(async (s) => ({
      group_id: s.group_id,
      summary: await summariseHousehold(s),
      reminders: remindersOn ? await remindHousehold(s) : ("disabled" as const),
    }))
  );

  const run = { checked: households.length, households };
  console.log("cron run", JSON.stringify(run));
  return Response.json(run);
}

/**
 * One message a day per admin: readings logged today, how many still need
 * review, and which slots that have started are still empty. Sent even when
 * the household has gone quiet, since a day with nothing logged is the one the
 * admin most needs to hear about.
 */
async function summariseHousehold(s: HouseholdSettings): Promise<SummaryResult> {
  const groupId = s.group_id;
  const tz = s.tz || "Asia/Bangkok";
  const slots = normalise(s.slots ?? DEFAULT_SLOTS);

  const admins = (await groupMembers(groupId)).filter((m) => m.is_admin && m.notify_ok);
  if (admins.length === 0) {
    console.warn("summary skipped, no reachable admin", { groupId });
    return { skipped: "no_admin" };
  }

  // Recorded BEFORE pushing, same as reminders: a retry or overlapping run
  // finds today's row already there and sends nothing.
  const { date, mins } = localParts(new Date(), tz);
  const fresh = await recordReminders(groupId, date, [SUMMARY_KEY]);
  if (fresh.length === 0) return { skipped: "already_sent" };

  const day = await dayCounts(groupId, date);
  const missing = slots
    .filter((sl) => mins >= minutes(sl.from) && !day.slots.has(sl.key))
    .map((sl) => sl.label);
  const text = msgDailySummary(day.logged, day.flagged, missing);

  let sent = 0;
  let failed = 0;
  for (const a of admins) {
    try {
      const result = await pushMessage(a.user_id, text, "summary");
      if (result.ok) sent++;
      else failed++;
    } catch (err) {
      failed++;
      if (err instanceof PushForbidden) {
        await markUnreachable(a.user_id);
      } else {
        console.error("summary push failed", { userId: a.user_id, err: String(err) });
      }
    }
  }

  return {
    logged: day.logged,
    flagged: day.flagged,
    missing: missing.length,
    sent,
    failed,
  };
}

async function remindHousehold(s: HouseholdSettings): Promise<HouseholdResult> {
  const groupId = s.group_id;
  const tz = s.tz || "Asia/Bangkok";
  const slots = normalise(s.slots ?? DEFAULT_SLOTS);

  const since = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
  if (!(await hasRecentReadings(groupId, since))) {
    const result: HouseholdResult = { group_id: groupId, skipped: "inactive", due: 0, sent: 0, failed: 0 };
    console.log("reminders household", result);
    return result;
  }

  const { date, mins } = localParts(new Date(), tz);
  const logged = await loggedSlots(groupId, date);

  // Actionable only: has a remind_at, that time has passed locally, and nothing
  // is recorded for this slot today yet.
  const due = slots.filter(
    (sl) => sl.remind_at && mins >= minutes(sl.remind_at) && !logged.has(sl.key)
  );

  if (due.length === 0) {
    const result: HouseholdResult = { group_id: groupId, due: 0, sent: 0, failed: 0 };
    console.log("reminders household", result);
    return result;
  }

  // Recorded BEFORE pushing — a slot already claimed by an earlier run today
  // (the other cron, or a duplicate firing of this one) drops out here silently.
  const newlyDue = await recordReminders(groupId, date, due.map((sl) => sl.key));
  if (newlyDue.length === 0) {
    const result: HouseholdResult = { group_id: groupId, due: due.length, sent: 0, failed: 0 };
    console.log("reminders household", result);
    return result;
  }

  const labels = slots.filter((sl) => newlyDue.includes(sl.key)).map((sl) => sl.label);
  const text = msgMissedEntry(labels);

  const members = await groupMembers(groupId);
  const targets = members.filter((m) => m.notify_ok && m.notify_reminders);

  let sent = 0;
  let failed = 0;
  await Promise.allSettled(
    targets.map(async (m) => {
      try {
        const result = await pushMessage(m.user_id, text, "reminder");
        if (result.ok) sent++;
        else failed++;
      } catch (err) {
        failed++;
        if (err instanceof PushForbidden) {
          await markUnreachable(m.user_id);
        } else {
          console.error("reminder push failed", { userId: m.user_id, err: String(err) });
        }
      }
    })
  );

  const result: HouseholdResult = { group_id: groupId, due: due.length, sent, failed };
  console.log("reminders household", result);
  return result;
}
