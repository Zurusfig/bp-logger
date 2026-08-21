export type Slot = "morning" | "evening";

/** Anything before this local hour belongs to the previous night's evening slot. */
const NIGHT_CUTOFF_HOUR = 3;

/** Local hour at which morning becomes evening. */
const MIDDAY_HOUR = 12;

function localParts(at: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(at).map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hour: Number(p.hour === "24" ? "0" : p.hour),
  };
}

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * A "before bed" reading taken at 00:20 has tomorrow's calendar date but belongs to
 * tonight's evening slot. reading_date is the day the doctor's table should show it
 * under; taken_at stays the true timestamp.
 */
export function deriveSlot(
  takenAt: Date,
  tz = "Asia/Bangkok"
): { slot: Slot; reading_date: string } {
  const { date, hour } = localParts(takenAt, tz);

  if (hour < NIGHT_CUTOFF_HOUR) {
    return { slot: "evening", reading_date: shiftDate(date, -1) };
  }
  return {
    slot: hour < MIDDAY_HOUR ? "morning" : "evening",
    reading_date: date,
  };
}