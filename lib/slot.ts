export type SlotDef = {
  key: string;
  label: string;
  /** Local "HH:MM" at which this slot begins. */
  from: string;
  /** Local "HH:MM" at which a missed-entry reminder fires. No remind_at = never reminded. */
  remind_at?: string;
};

export const DEFAULT_SLOTS: SlotDef[] = [
  { key: "wake", label: "ตื่นนอน", from: "04:00", remind_at: "09:00" },
  { key: "after_med", label: "หลังยาเช้า", from: "08:30", remind_at: "09:00" },
  { key: "bedtime", label: "ก่อนนอน", from: "15:00", remind_at: "22:00" },
];

export function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Slots sorted by start time, so window lookup is a simple scan. */
export function normalise(slots: SlotDef[]): SlotDef[] {
  const clean = slots.filter((s) => s.key && /^\d{1,2}:\d{2}$/.test(s.from));
  if (clean.length === 0) return DEFAULT_SLOTS;
  return [...clean].sort((a, b) => minutes(a.from) - minutes(b.from));
}

/** Local calendar date and minutes-since-midnight for a household's tz. */
export function localParts(at: Date, tz: string) {
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
    mins: Number(p.hour === "24" ? 0 : p.hour) * 60 + Number(p.minute),
  };
}

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Assigns a reading to a slot and to the day the report should file it under.
 *
 * A reading before the first slot's start belongs to the previous day's last slot,
 * so a "before bed" measurement taken at 00:20 does not create a phantom entry on
 * the following morning.
 *
 * Clock windows are a best guess. Slots that sit close together (waking versus
 * after morning medicine) will sometimes land in the wrong one, which is why the
 * slot stays editable on every row.
 */
export function deriveSlot(
  takenAt: Date,
  slots: SlotDef[] = DEFAULT_SLOTS,
  tz = "Asia/Bangkok"
): { slot: string; reading_date: string } {
  const defs = normalise(slots);
  const { date, mins } = localParts(takenAt, tz);

  if (mins < minutes(defs[0].from)) {
    return { slot: defs[defs.length - 1].key, reading_date: shiftDate(date, -1) };
  }

  let chosen = defs[0];
  for (const s of defs) {
    if (mins >= minutes(s.from)) chosen = s;
    else break;
  }

  return { slot: chosen.key, reading_date: date };
}

export function slotLabel(key: string | null, slots: SlotDef[] = DEFAULT_SLOTS): string {
  if (!key) return "";
  return slots.find((s) => s.key === key)?.label ?? key;
}

/** Sort order for display, so a day's readings run in slot order. */
export function slotIndex(key: string | null, slots: SlotDef[] = DEFAULT_SLOTS): number {
  if (!key) return 999;
  const i = normalise(slots).findIndex((s) => s.key === key);
  return i === -1 ? 999 : i;
}