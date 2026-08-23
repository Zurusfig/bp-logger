import { isAllowedGroup } from "@/lib/groups";
import {
  allSettings,
  groupMembers,
  hasRecentReadings,
  loggedSlots,
  markUnreachable,
  recordReminders,
  type HouseholdSettings,
} from "@/lib/db";
import { pushMessage, PushForbidden } from "@/lib/line";
import { msgMissedEntry } from "@/lib/messages";
import { DEFAULT_SLOTS, localParts, minutes, normalise } from "@/lib/slot";

export const runtime = "nodejs";
export const maxDuration = 60;

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

type HouseholdResult = {
  group_id: string;
  skipped?: "inactive";
  due: number;
  sent: number;
  failed: number;
};

/**
 * Fired by two Vercel Hobby cron entries (09:00 and 22:00 Bangkok, see
 * vercel.json) that both hit this same endpoint. It doesn't know which one woke
 * it — it just works out from the data what's due right now, which is what
 * makes repeated or overlapping invocations harmless.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const settings = (await allSettings()).filter((s) => isAllowedGroup(s.group_id));
  const households = await Promise.all(settings.map(processHousehold));

  const summary = {
    checked: households.length,
    households,
  };
  console.log("reminders run", JSON.stringify(summary));
  return Response.json(summary);
}

async function processHousehold(s: HouseholdSettings): Promise<HouseholdResult> {
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
        await pushMessage(m.user_id, text);
        sent++;
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
