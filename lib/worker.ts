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
} from "./db";

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

// -------------------------------------------------------------- notification

async function notify(
  userId: string,
  readingId: string,
  r: Reading,
  validationIssue: string | null
): Promise<void> {
  const missing = FIELDS.filter((f) => r[f] === null);

  let text: string;
  if (missing.length === 0 && !needsReview(r)) {
    text = `✅ ${r.sys}/${r.dia} ชีพจร ${r.pulse} บันทึกแล้ว`;
  } else if (missing.length === FIELDS.length) {
    text =
      `⚠️ อ่านไม่ออก${validationIssue ? ` (${validationIssue})` : ""}\n` +
      `พิมพ์ตัวเลขตอบกลับได้เลย เช่น 95/50/46 หรือถ่ายใหม่`;
    await setPending(userId, readingId, [...missing]);
  } else if (missing.length > 0) {
    const known = FIELDS.filter((f) => r[f] !== null)
      .map((f) => `${f.toUpperCase()} ${r[f]}`)
      .join(", ");
    text =
      `⚠️ อ่าน ${missing.join(", ").toUpperCase()} ไม่ออก (${known})\n` +
      `พิมพ์แค่ตัวเลข ${missing.join(", ").toUpperCase()} ตอบกลับได้เลย`;
    await setPending(userId, readingId, [...missing]);
  } else {
    text = `📝 ${r.sys}/${r.dia} ชีพจร ${r.pulse} บันทึกแล้ว (รอตรวจสอบ)`;
  }

  try {
    await pushMessage(userId, text);
  } catch (err) {
    if (err instanceof PushForbidden) {
      // Not a friend of the OA. Stay silent, never fall back to the group.
      await markUnreachable(userId);
      console.warn("push forbidden, marked unreachable", { userId });
      return;
    }
    throw err;
  }
}

// --------------------------------------------------------------------- text

/** Task 3.9: typed numbers completing a failed read, 1:1 only. */
async function handleText(e: LineEvent): Promise<void> {
  if (e.source.type !== "user") return; // never parse text in the group
  const userId = e.source.userId;
  const text = e.message?.text?.trim();
  if (!userId || !text) return;

  const pending = await getPending(userId);
  if (!pending) return;

  const nums = text.match(/\d{2,3}/g)?.map(Number) ?? [];
  const missing = pending.missing as (typeof FIELDS)[number][];

  if (nums.length !== missing.length) {
    await pushMessage(
      userId,
      `พิมพ์ ${missing.length} ตัวเลข (${missing.join(", ").toUpperCase()})`
    );
    return;
  }

  const vals = Object.fromEntries(missing.map((f, i) => [f, nums[i]])) as Record<
    string,
    number
  >;

  await completeReading(pending.reading_id, vals, userId);
  await clearPending(userId);

  const shown = missing.map((f) => `${f.toUpperCase()} ${vals[f]}`).join(", ");
  await pushMessage(userId, `✅ ${shown} บันทึกแล้ว`);
}