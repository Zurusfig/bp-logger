import {
  getMessageContent,
  getGroupMemberName,
  pushMessage,
  PushForbidden,
  type LineEvent,
} from "./line";
import { couldBeBpPhoto, isBpDisplay, DAILY_CALL_CAP } from "./prefilter";
import { readDisplayCorrected, validate, needsReview, type Reading } from "./ocr";
import { deriveSlot } from "./slot";
import { isAllowedGroup as allowedGroup } from "./groups";
import {
  ensureMember,
  memberGroup,
  markUnreachable,
  groupMembers,
  hashImage,
  findByHash,
  insertReading,
  uploadImage,
  setImagePath,
  completeReading,
  setPending,
  getPending,
  clearPending,
  bumpUsage,
  recentReadingBySender,
  getSlots,
} from "./db";
import {
  msgPartial,
  msgSaved,
  msgSavedUnsure,
  msgSavedByOther,
  msgSavedUnsureByOther,
  msgUnreadable,
  msgUpdated,
  msgWrongCount,
  msgTypedEntry,
  msgTypedEntryByOther,
  msgInvalidEntry,
} from "./messages";

const FIELDS = ["sys", "dia", "pulse"] as const;

export async function processEvents(events: LineEvent[]): Promise<void> {
  // One bad event must never kill the rest of the batch.
  await Promise.allSettled(events.map((e) => handleEvent(e).catch(logErr(e))));
}

const logErr = (e: LineEvent) => (err: unknown) =>
  console.error("event failed", { type: e.type, id: e.message?.id, err: String(err) });

async function handleEvent(e: LineEvent): Promise<void> {
  // Enrolment happens on ANY activity in the allowed group, not just posting a
  // reading — otherwise a member who never sends a photo or types a reading has
  // no members row and resolveSession() locks them out of the LIFF app entirely.
  if (e.source.type === "group" && e.source.groupId && e.source.userId) {
    const groupId = e.source.groupId;
    const userId = e.source.userId;
    if (allowedGroup(groupId)) {
      try {
        const name = await getGroupMemberName(groupId, userId);
        await ensureMember(groupId, userId, name);
      } catch (err) {
        console.error("enrol failed", { groupId, userId, err: String(err) });
      }
    }
  }

  if (e.type === "memberJoined" && e.source.type === "group" && e.source.groupId) {
    const groupId = e.source.groupId;
    if (allowedGroup(groupId)) {
      for (const m of e.joined?.members ?? []) {
        if (!m.userId) continue;
        try {
          const name = await getGroupMemberName(groupId, m.userId);
          await ensureMember(groupId, m.userId, name);
        } catch (err) {
          console.error("enrol failed", { groupId, userId: m.userId, err: String(err) });
        }
      }
    }
  }

  if (e.type !== "message" || !e.message) return;
  if (e.message.type === "image") return handleImage(e);
  if (e.message.type === "text") return handleText(e);
}

// ------------------------------------------------------------------- images

async function handleImage(e: LineEvent): Promise<void> {
  const isDirect = e.source.type === "user";
  const userId = e.source.userId;
  if (!userId) return;

  const groupId = isDirect ? await memberGroup(userId) : e.source.groupId;
  if (!groupId) return; // 1:1 from someone with no household yet
  if (!isDirect && !allowedGroup(groupId)) return;

  // Fetch immediately — LINE expires content quickly.
  const buf = await getMessageContent(e.message!.id);

  // FR-1.6: the same image twice. Two readings minutes apart are NOT duplicates.
  const hash = hashImage(buf);
  if (await findByHash(groupId, hash)) return;

  // Stage 1: free, permissive shape checks.
  if (!(await couldBeBpPhoto(buf))) return;

  // Stage 2: cheap triage. Skipped in a 1:1 chat — forwarding a photo there is an
  // explicit "please read this", so it always gets the full pipeline.
  if (!isDirect) {
    await bumpUsage(groupId, 0, 1);
    if (!(await isBpDisplay(buf))) {
      console.log("triage rejected", { messageId: e.message!.id, userId, groupId });
      return;
    }
  }

  const used = await bumpUsage(groupId, 1, 0);
  if (used > DAILY_CALL_CAP) {
    console.warn("daily cap hit", { groupId, used });
    return;
  }

  const reading = await readDisplayCorrected(buf);

  // FR-1.3: not a BP display after the full read — silent drop, nothing stored.
  if (!reading.is_bp_display) return;

  const { ok, issues } = validate(reading);
  const cleaned: Reading = ok
    ? reading
    : { ...reading, sys: null, dia: null, pulse: null };

  const postedAt = new Date(e.timestamp);
  const slots = await getSlots(groupId);
  const { slot, reading_date } = deriveSlot(postedAt, slots ?? undefined);

  const id = await insertReading({
    groupId,
    senderId: userId,
    takenAt: postedAt,
    postedAt,
    reading: cleaned,
    imageHash: hash,
    slot,
    readingDate: reading_date,
    needsReview: needsReview(cleaned) || !ok,
    reviewNote: ok ? null : issues.join("; "),
  });

  // Image is the receipt (FR-1.5). Upload after the insert so we have the id.
  try {
    await setImagePath(id, await uploadImage(groupId, id, buf));
  } catch (err) {
    console.error("image upload failed", { id, err: String(err) });
  }

  await notify(groupId, userId, id, cleaned, ok ? null : issues.join("; "));
}

// ---------------------------------------------------------------------------
// M5: replace the existing notify() and handleText() in lib/worker.ts with these,
// and add this import at the top of the file:
//
//   import {
//     msgSaved, msgSavedUnsure, msgPartial, msgUnreadable,
//     msgUpdated, msgWrongCount,
//   } from "./messages";
// ---------------------------------------------------------------------------

/**
 * Pushes the same reading to every other household member who wants to hear
 * about it (notify_ok AND notify_all). Runs concurrently and never throws — a
 * lookup failure, a build failure, or one member's push failing must never take
 * down the others or bubble up to the caller, since the reading is already saved
 * by the time this runs.
 */
async function notifyHousehold(
  groupId: string,
  senderId: string,
  build: (senderName?: string | null) => string
): Promise<void> {
  try {
    const members = await groupMembers(groupId);
    const others = members.filter(
      (m) => m.user_id !== senderId && m.notify_ok && m.notify_all
    );
    if (others.length === 0) return;

    const sender = members.find((m) => m.user_id === senderId);
    const text = build(sender?.display_name);

    await Promise.allSettled(
      others.map(async (m) => {
        try {
          await pushMessage(m.user_id, text);
        } catch (err) {
          if (err instanceof PushForbidden) {
            await markUnreachable(m.user_id);
            console.warn("push forbidden, marked unreachable", { userId: m.user_id });
          } else {
            console.error("household push failed", { userId: m.user_id, err: String(err) });
          }
        }
      })
    );
  } catch (err) {
    console.error("household fanout failed", { groupId, senderId, err: String(err) });
  }
}

async function notify(
  groupId: string,
  userId: string,
  readingId: string,
  r: Reading,
  validationIssue: string | null
): Promise<void> {
  const missing = FIELDS.filter((f) => r[f] === null);
  const vals = { sys: r.sys, dia: r.dia, pulse: r.pulse };

  let text: string;
  // Set only when this state should fan out to the rest of the household: a
  // reading saved cleanly, or saved but flagged for review. Prompts for missing
  // values and unreadable-photo retries stay 1:1 with the sender.
  let fanOut: ((senderName?: string | null) => string) | null = null;

  if (missing.length === FIELDS.length) {
    text = msgUnreadable(readingId);
    await setPending(userId, readingId, [...missing]);
  } else if (missing.length > 0) {
    text = msgPartial(vals, [...missing], readingId);
    await setPending(userId, readingId, [...missing]);
  } else if (needsReview(r) || validationIssue) {
    text = msgSavedUnsure(vals, readingId);
    // No pending state: with all three values present, a typed reply is an
    // overwrite rather than a fill, handled by the recent-reading path below.
    fanOut = (name) => msgSavedUnsureByOther(vals, readingId, name);
  } else {
    text = msgSaved(vals, readingId);
    fanOut = (name) => msgSavedByOther(vals, readingId, name);
  }

  // The sender's own push failing (e.g. they blocked the OA) must not skip
  // notifying the rest of the household, so it's tracked and rethrown after —
  // not before — the fan-out runs.
  let senderErr: unknown = null;
  try {
    await pushMessage(userId, text);
  } catch (err) {
    if (err instanceof PushForbidden) {
      await markUnreachable(userId);
      console.warn("push forbidden, marked unreachable", { userId });
    } else {
      senderErr = err;
    }
  }

  if (fanOut) await notifyHousehold(groupId, userId, fanOut);
  if (senderErr) throw senderErr;
}

// -------------------------------------------------------------- typed entry

/**
 * A typed entry with no image: source='text', no image_path/image_hash, and
 * needs_review=false since a human typed the numbers directly. Same validation
 * gate as the image path (range, sys > dia, gap > 10) and the same deriveSlot()
 * against the household's configured slots.
 */
async function insertTypedReading(
  groupId: string,
  senderId: string,
  timestampMs: number,
  vals: { sys: number; dia: number; pulse: number }
): Promise<{ ok: true; id: string } | { ok: false; issues: string[] }> {
  const check = validate({
    sys: vals.sys,
    dia: vals.dia,
    pulse: vals.pulse,
    orientation_deg: 0,
    observations: "",
    is_bp_display: true,
    irregular_flag: null,
    confidence: 1,
  });
  if (!check.ok) return { ok: false, issues: check.issues };

  const postedAt = new Date(timestampMs);
  const slots = await getSlots(groupId);
  const { slot, reading_date } = deriveSlot(postedAt, slots ?? undefined);

  const id = await insertReading({
    groupId,
    senderId,
    takenAt: postedAt,
    postedAt,
    slot,
    readingDate: reading_date,
    sys: vals.sys,
    dia: vals.dia,
    pulse: vals.pulse,
    source: "text",
    needsReview: false,
  });

  return { ok: true, id };
}

async function handleText(e: LineEvent): Promise<void> {
  if (e.source.type === "user") return handleDirectText(e);
  if (e.source.type === "group") return handleGroupText(e);
  // rooms: unsupported, same as before
}

/**
 * Only a message that is ONLY three numbers with separators, nothing else, so
 * ordinary chat ("โทร 02 123 4567", "ราคา 100 200 300") can never trigger this.
 * Anchored at both ends: any leading/trailing word, or a 4th number, fails the match.
 */
const GROUP_TEXT_RE = /^\s*(\d{2,3})\s*[\/\s\-]\s*(\d{2,3})\s*[\/\s\-]\s*(\d{2,3})\s*$/;

/** Typed numbers in the group chat: strict match only, confirmation goes to the sender's 1:1. */
async function handleGroupText(e: LineEvent): Promise<void> {
  const userId = e.source.userId;
  const groupId = e.source.groupId;
  const text = e.message?.text;
  if (!userId || !groupId || !text) return;
  if (!allowedGroup(groupId)) return;

  const m = text.match(GROUP_TEXT_RE);
  if (!m) return;

  const vals = { sys: Number(m[1]), dia: Number(m[2]), pulse: Number(m[3]) };
  const result = await insertTypedReading(groupId, userId, e.timestamp, vals);

  if (!result.ok) {
    await pushMessage(userId, msgInvalidEntry(vals, result.issues));
    return;
  }
  await pushMessage(userId, msgTypedEntry(vals, result.id));
  await notifyHousehold(groupId, userId, (name) =>
    msgTypedEntryByOther(vals, result.id, name)
  );
}

/** Typed numbers in a 1:1 chat: fills a pending read, or overwrites a recent one. */
async function handleDirectText(e: LineEvent): Promise<void> {
  const userId = e.source.userId;
  const text = e.message?.text?.trim();
  if (!userId || !text) return;

  const nums = text.match(/\d{2,3}/g)?.map(Number) ?? [];
  if (nums.length === 0) return;

  const pending = await getPending(userId);

  // Case 1: a read that came back incomplete is waiting for the missing fields.
  if (pending) {
    const missing = pending.missing as (typeof FIELDS)[number][];

    if (nums.length !== missing.length) {
      // Three numbers when one was asked for is a full correction, not a mistake.
      if (nums.length === 3) {
        await completeReading(
          pending.reading_id,
          { sys: nums[0], dia: nums[1], pulse: nums[2] },
          userId
        );
        await clearPending(userId);
        await pushMessage(
          userId,
          msgUpdated({ sys: nums[0], dia: nums[1], pulse: nums[2] })
        );
        return;
      }
      await pushMessage(userId, msgWrongCount(missing));
      return;
    }

    const vals = Object.fromEntries(missing.map((f, i) => [f, nums[i]])) as Record<
      string,
      number
    >;
    await completeReading(pending.reading_id, vals, userId);
    await clearPending(userId);
    await pushMessage(userId, msgUpdated(vals));
    return;
  }

  // Case 2: three numbers with nothing pending overwrites the sender's most recent
  // reading, for the case where the bot read it wrong and they noticed straight away.
  if (nums.length === 3) {
    const recent = await recentReadingBySender(userId, 60);
    if (recent) {
      await completeReading(
        recent,
        { sys: nums[0], dia: nums[1], pulse: nums[2] },
        userId
      );
      await pushMessage(userId, msgUpdated({ sys: nums[0], dia: nums[1], pulse: nums[2] }));
      return;
    }

    // Case 3: nothing to attach to. No prior reading at all — a fresh entry with
    // no image, for when the monitor cannot be photographed.
    const groupId = await memberGroup(userId);
    if (!groupId) return; // 1:1 from someone with no household yet
    const vals = { sys: nums[0], dia: nums[1], pulse: nums[2] };
    const result = await insertTypedReading(groupId, userId, e.timestamp, vals);

    if (!result.ok) {
      await pushMessage(userId, msgInvalidEntry(vals, result.issues));
      return;
    }
    await pushMessage(userId, msgTypedEntry(vals, result.id));
    await notifyHousehold(groupId, userId, (name) =>
      msgTypedEntryByOther(vals, result.id, name)
    );
  }
}