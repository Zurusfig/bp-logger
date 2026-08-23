/**
 * Every user-facing string the bot sends, in one place.
 *
 * House style: status line, then values, then the one thing to do. Statements only,
 * no questions, no emoji, no dashes. Examples are built from the reading's own
 * numbers so the expected format is never abstract.
 */

export type Vals = {
  sys: number | null;
  dia: number | null;
  pulse: number | null;
};

const FIELD_LABEL: Record<string, string> = {
  sys: "SYS",
  dia: "DIA",
  pulse: "ชีพจร",
};

export function editLink(readingId: string): string | null {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  if (!liffId) return null;
  return `https://liff.line.me/${liffId}?id=${readingId}`;
}

/** "SYS 95  DIA 50  ชีพจร 46", skipping anything unread. */
function valueLine(v: Vals): string {
  return (["sys", "dia", "pulse"] as const)
    .filter((f) => v[f] !== null)
    .map((f) => `${FIELD_LABEL[f]} ${v[f]}`)
    .join("  ");
}

function withLink(lines: string[], readingId: string, verb: string): string {
  const link = editLink(readingId);
  if (link) lines.push(`${verb} ${link}`);
  return lines.join("\n");
}

/** Read cleanly and confidently. */
export function msgSaved(v: Vals, readingId: string): string {
  return withLink(["บันทึกแล้ว", valueLine(v)], readingId, "แก้ไข");
}

/** Saved, but the model was not confident. Show how to overwrite by text. */
export function msgSavedUnsure(v: Vals, readingId: string): string {
  const example = `${v.sys}/${v.dia}/${v.pulse}`;
  return withLink(
    [
      "บันทึกแล้ว รอการตรวจสอบ",
      valueLine(v),
      `ถ้าไม่ตรง พิมพ์ค่าใหม่ตอบกลับ เช่น ${example}`,
    ],
    readingId,
    "หรือแก้ไขที่"
  );
}

/** Some fields readable, at least one not. */
export function msgPartial(v: Vals, missing: string[], readingId: string): string {
  const labels = missing.map((f) => FIELD_LABEL[f]).join(" ");
  const example = missing.length === 1 ? exampleFor(missing[0]) : "95/50/46";

  return withLink(
    [
      `บันทึกไม่ครบ อ่านค่า ${labels} ไม่ได้`,
      valueLine(v),
      `พิมพ์ค่า ${labels} ตอบกลับ เช่น ${example}`,
    ],
    readingId,
    "หรือแก้ไขที่"
  );
}

/** Nothing readable at all. */
export function msgUnreadable(readingId: string): string {
  return withLink(
    ["อ่านค่าจากรูปไม่ได้", "พิมพ์ค่าตอบกลับ เช่น 95/50/46", "หรือถ่ายรูปใหม่"],
    readingId,
    "หรือแก้ไขที่"
  );
}

/** Confirmation after the sender typed the missing numbers. */
export function msgUpdated(patched: Partial<Vals>): string {
  const line = (["sys", "dia", "pulse"] as const)
    .filter((f) => patched[f] != null)
    .map((f) => `${FIELD_LABEL[f]} ${patched[f]}`)
    .join("  ");
  return ["อัปเดตแล้ว", line].join("\n");
}

/** Typed entry with no photo attached. */
export function msgTypedEntry(v: Vals, readingId: string): string {
  return withLink(["บันทึกแล้ว (พิมพ์เอง)", valueLine(v)], readingId, "แก้ไข");
}

/** Stand-in name when the sender has no display_name on file. */
const NEUTRAL_SENDER = "สมาชิกในครอบครัว";

function nameOrNeutral(senderName?: string | null): string {
  return senderName?.trim() || NEUTRAL_SENDER;
}

/** Household fan-out: someone else's reading was read cleanly and confidently. */
export function msgSavedByOther(v: Vals, readingId: string, senderName?: string | null): string {
  return withLink(
    [`${nameOrNeutral(senderName)} บันทึกความดันแล้ว`, valueLine(v)],
    readingId,
    "แก้ไข"
  );
}

/** Household fan-out: someone else's reading saved, but flagged for review. */
export function msgSavedUnsureByOther(
  v: Vals,
  readingId: string,
  senderName?: string | null
): string {
  return withLink(
    [`${nameOrNeutral(senderName)} บันทึกความดันแล้ว รอการตรวจสอบ`, valueLine(v)],
    readingId,
    "แก้ไข"
  );
}

/** Household fan-out: someone else typed in a reading with no photo attached. */
export function msgTypedEntryByOther(
  v: Vals,
  readingId: string,
  senderName?: string | null
): string {
  return withLink(
    [`${nameOrNeutral(senderName)} บันทึกความดันแล้ว (พิมพ์เอง)`, valueLine(v)],
    readingId,
    "แก้ไข"
  );
}

/** Wrong number of values typed. */
export function msgWrongCount(missing: string[]): string {
  const labels = missing.map((f) => FIELD_LABEL[f]).join(" ");
  const example = missing.length === 1 ? exampleFor(missing[0]) : "95/50/46";
  return [`ต้องการค่า ${labels}`, `พิมพ์ตอบกลับ เช่น ${example}`].join("\n");
}

const ISSUE_LABEL: Record<string, string> = {
  "sys out of range": "SYS อยู่นอกช่วงที่เป็นไปได้",
  "dia out of range": "DIA อยู่นอกช่วงที่เป็นไปได้",
  "pulse out of range": "ชีพจรอยู่นอกช่วงที่เป็นไปได้",
  "sys <= dia": "SYS ต้องมากกว่า DIA",
  "gap <= 10": "SYS กับ DIA ต่างกันน้อยเกินไป",
};

/** Typed numbers rejected by the validation gate (range, sys<=dia, gap too small). */
export function msgInvalidEntry(v: Vals, issues: string[]): string {
  const reasons = issues.map((i) => ISSUE_LABEL[i] ?? i).join(" ");
  return [
    "บันทึกไม่ได้",
    valueLine(v),
    reasons,
    "พิมพ์ค่าใหม่ตอบกลับ เช่น 120/70/60",
  ].join("\n");
}

/**
 * Missed-entry reminder: a checklist prompt, not a health warning. Never mentions
 * values, risk, or outcomes, and carries no action line — same shape whether one
 * slot or several are due.
 */
export function msgMissedEntry(labels: string[]): string {
  return ["ยังไม่ได้บันทึกความดันวันนี้", `เวลา: ${labels.join(" ")}`].join("\n");
}

/** A plausible single value, so the example never looks like a placeholder. */
function exampleFor(field: string): string {
  if (field === "sys") return "120";
  if (field === "dia") return "70";
  return "60";
}