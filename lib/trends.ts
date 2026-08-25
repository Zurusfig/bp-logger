import type { ReadingDto } from "@/app/api/readings/route";
import { localParts, normalise, type SlotDef } from "@/lib/slot";

/**
 * Muted, warm-neutral tones in the same family as the ink/rule palette —
 * never the amber accent, which stays reserved for needs-review. This is the
 * one place in the app allowed more than one colour, because slot identity
 * has to be distinguishable; the same slot keeps the same colour in every
 * chart and in the numbers row. Cycles if a household configures more slots
 * than colours (unusual — most run 2-4).
 */
export const SLOT_COLORS = [
  "#8c5a44", // muted terracotta
  "#5b6b73", // muted slate
  "#6b7350", // muted olive
  "#7a5566", // muted plum
  "#7d6b46", // muted ochre
  "#4f6b6b", // muted teal-gray
];

export function slotColor(index: number): string {
  return SLOT_COLORS[index % SLOT_COLORS.length];
}

/** Readings a trend can safely use: verified, and with both numbers present. */
export function eligible(readings: ReadingDto[]): ReadingDto[] {
  return readings.filter((r) => !r.needs_review && r.sys != null && r.dia != null);
}

export function excludedCount(readings: ReadingDto[]): number {
  return readings.filter((r) => r.needs_review).length;
}

function readingDate(r: ReadingDto): string {
  return r.reading_date ?? r.taken_at.slice(0, 10);
}

export type SlotPoint = { t: number; sys: number; dia: number; range: number };
export type SlotSeries = { def: SlotDef; color: string; points: SlotPoint[] };

/**
 * One series per configured slot, each point a single reading (never a
 * per-day average — a session's two readings stay two points, minutes
 * apart on the time axis). All series share one continuous time domain and
 * one y-domain so the stacked mini-charts read as directly comparable.
 */
export function bySlot(
  readings: ReadingDto[],
  slots: SlotDef[],
): { series: SlotSeries[]; tDomain: [number, number]; yDomain: [number, number] } {
  const defs = normalise(slots);
  const rows = eligible(readings);

  const byKey = new Map<string, ReadingDto[]>();
  for (const r of rows) {
    const key = r.slot ?? defs[0].key;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(r);
  }

  const series: SlotSeries[] = defs.map((def, i) => {
    const rs = [...(byKey.get(def.key) ?? [])].sort(
      (a, b) => new Date(a.taken_at).getTime() - new Date(b.taken_at).getTime(),
    );
    return {
      def,
      color: slotColor(i),
      points: rs.map((r) => ({
        t: new Date(r.taken_at).getTime(),
        sys: r.sys!,
        dia: r.dia!,
        range: r.sys! - r.dia!,
      })),
    };
  });

  const allT = rows.map((r) => new Date(r.taken_at).getTime());
  const allSys = rows.map((r) => r.sys!);
  const allDia = rows.map((r) => r.dia!);

  const tDomain: [number, number] = allT.length ? [Math.min(...allT), Math.max(...allT)] : [0, 1];
  const yDomain: [number, number] = allSys.length
    ? [Math.floor((Math.min(...allDia) - 10) / 10) * 10, Math.ceil((Math.max(...allSys) + 10) / 10) * 10]
    : [40, 180];

  return { series, tDomain, yDomain };
}

export type ScatterSeries = { def: SlotDef; color: string; points: { hour: number; sys: number }[] };

/** Every reading pooled by hour-of-day, so the shape is a daily rhythm rather than a trend. */
export function timeOfDay(readings: ReadingDto[], slots: SlotDef[], tz = "Asia/Bangkok"): ScatterSeries[] {
  const defs = normalise(slots);
  const rows = eligible(readings);
  return defs.map((def, i) => ({
    def,
    color: slotColor(i),
    points: rows
      .filter((r) => (r.slot ?? defs[0].key) === def.key)
      .map((r) => ({ hour: localParts(new Date(r.taken_at), tz).mins / 60, sys: r.sys! })),
  }));
}

const DAY_MS = 86_400_000;
const isoDaysAgo = (n: number) => new Date(Date.now() - n * DAY_MS).toISOString().slice(0, 10);
const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export type WeeklyMean = {
  def: SlotDef;
  color: string;
  thisWeek: number | null;
  lastWeek: number | null;
  delta: number | null;
};

/** Rolling 7-day windows, not calendar weeks — stable regardless of what day it is. */
export function weeklyMeans(readings: ReadingDto[], slots: SlotDef[]): WeeklyMean[] {
  const defs = normalise(slots);
  const rows = eligible(readings);
  const thisFrom = isoDaysAgo(6);
  const lastFrom = isoDaysAgo(13);
  const lastTo = isoDaysAgo(7);

  return defs.map((def, i) => {
    const forSlot = rows.filter((r) => (r.slot ?? defs[0].key) === def.key);
    const thisWeek = mean(forSlot.filter((r) => readingDate(r) >= thisFrom).map((r) => r.sys!));
    const lastWeek = mean(
      forSlot.filter((r) => readingDate(r) >= lastFrom && readingDate(r) <= lastTo).map((r) => r.sys!),
    );
    return {
      def,
      color: slotColor(i),
      thisWeek,
      lastWeek,
      delta: thisWeek != null && lastWeek != null ? thisWeek - lastWeek : null,
    };
  });
}

/** Logged-vs-expected for the trailing 7 days; expected assumes 2 readings per slot per day. */
export function compliance(readings: ReadingDto[], slots: SlotDef[]): { logged: number; expected: number } {
  const defs = normalise(slots);
  const from = isoDaysAgo(6);
  const logged = eligible(readings).filter((r) => readingDate(r) >= from).length;
  return { logged, expected: defs.length * 2 * 7 };
}

/**
 * Mean absolute SYS difference between the two readings of a session
 * (same day, same slot). Sessions with anything other than exactly two
 * valid readings are left out rather than guessed at — a large spread here
 * usually means cuff position or movement, not a health change.
 */
export function withinSessionSpread(readings: ReadingDto[]): { mean: number | null; sessions: number } {
  const rows = eligible(readings);
  const bySession = new Map<string, number[]>();
  for (const r of rows) {
    const key = `${readingDate(r)}|${r.slot ?? ""}`;
    if (!bySession.has(key)) bySession.set(key, []);
    bySession.get(key)!.push(r.sys!);
  }
  const diffs: number[] = [];
  for (const sysList of bySession.values()) {
    if (sysList.length === 2) diffs.push(Math.abs(sysList[0] - sysList[1]));
  }
  return { mean: mean(diffs), sessions: diffs.length };
}
