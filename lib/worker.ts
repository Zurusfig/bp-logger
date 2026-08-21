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
import {
  ensureMember,
  memberGroup,
  markUnreachable,
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
} from "./db";
import { msgPartial, msgSaved, msgSavedUnsure, msgUnreadable, msgUpdated, msgWrongCount } from "./messages";

const FIELDS = ["sys", "dia", "pulse"] as const;

/** Only this household's group is processed. Everything else is ignored outright. */
function allowedGroup(groupId?: string): boolean {
  const allow = process.env.ALLOWED_GROUP_ID;
  if (!allow) return true; // unset = accept any group (self-hosters)
  return groupId === allow;
}

export async function processEvents(events: LineEvent[]): Promise<void> {
  // One bad event must never kill the rest of the batch.
  await Promise.allSettled(events.map((e) => handleEvent(e).catch(logErr(e))));
}

const logErr = (e: LineEvent) => (err: unknown) =>
  console.error("event failed", { type: e.type, id: e.message?.id, err: String(err) });

async function handleEvent(e: LineEvent): Promise<void> {
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

  if (!isDirect) {
    const name = await getGroupMemberName(groupId, userId);
    await ensureMember(groupId, userId, name);
  }

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
  const { slot, reading_date } = deriveSlot(postedAt);

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

  await notify(userId, id, cleaned, ok ? null : issues.join("; "));
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

async function notify(
  userId: string,
  readingId: string,
  r: Reading,
  validationIssue: string | null
): Promise<void> {
  const missing = FIELDS.filter((f) => r[f] === null);
  const vals = { sys: r.sys, dia: r.dia, pulse: r.pulse };

  let text: string;
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
  } else {
    text = msgSaved(vals, readingId);
  }

  try {
    await pushMessage(userId, text);
  } catch (err) {
    if (err instanceof PushForbidden) {
      await markUnreachable(userId);
      console.warn("push forbidden, marked unreachable", { userId });
      return;
    }
    throw err;
  }
}

/** Typed numbers in a 1:1 chat: fills a pending read, or overwrites a recent one. */
async function handleText(e: LineEvent): Promise<void> {
  if (e.source.type !== "user") return; // never parse text in the group
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
  }

  // Case 3: nothing to attach to. M5.6 turns this into a new text-only reading.
}