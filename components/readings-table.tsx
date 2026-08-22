"use client";

import type { ReadingDto } from "@/app/api/readings/route";
import { DEFAULT_SLOTS, normalise, slotLabel, type SlotDef } from "@/lib/slot";

const TH_MONTHS = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

function thaiDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${TH_MONTHS[m - 1]} ${String((y + 543) % 100).padStart(2, "0")}`;
}

function clockTime(iso: string, tz = "Asia/Bangkok"): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

type DayGroup = {
  date: string;
  slots: { slot: string; rows: ReadingDto[] }[];
};

/**
 * Groups by day, then by slot in the household's configured order.
 *
 * Slot keys are user-defined, so anything not in the config still renders (under
 * its raw key at the end) rather than vanishing from the table.
 */
function group(readings: ReadingDto[], slots: SlotDef[]): DayGroup[] {
  const defs = normalise(slots);
  const known = new Set(defs.map((s) => s.key));
  const byDate = new Map<string, Map<string, ReadingDto[]>>();

  for (const r of readings) {
    const date = r.reading_date ?? r.taken_at.slice(0, 10);
    const slot = r.slot ?? defs[0].key;
    if (!byDate.has(date)) byDate.set(date, new Map());
    const m = byDate.get(date)!;
    if (!m.has(slot)) m.set(slot, []);
    m.get(slot)!.push(r);
  }

  return [...byDate.entries()].map(([date, m]) => {
    const ordered = defs.filter((s) => m.has(s.key)).map((s) => s.key);
    const extra = [...m.keys()].filter((k) => !known.has(k));
    return {
      date,
      slots: [...ordered, ...extra].map((slot) => ({ slot, rows: m.get(slot)! })),
    };
  });
}

function Value({ v }: { v: number | null }) {
  if (v === null) return <span className="text-stone-300">-</span>;
  return <>{v}</>;
}

export function ReadingsTable({
  readings,
  slots = DEFAULT_SLOTS,
  onSelect,
}: {
  readings: ReadingDto[];
  slots?: SlotDef[];
  onSelect?: (r: ReadingDto) => void;
}) {
  if (readings.length === 0) {
    return (
      <p className="px-4 py-16 text-center text-stone-500">ยังไม่มีข้อมูลในช่วงนี้</p>
    );
  }

  return (
    <div className="tabular-nums">
      {/* column header, shown once at the top like a paper form */}
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-stone-300 bg-stone-50 px-4 py-2 text-xs tracking-wide text-stone-500">
        <span className="w-12">เวลา</span>
        <span className="w-16 text-right">SYS</span>
        <span className="w-16 text-right">DIA</span>
        <span className="w-16 text-right">ชีพจร</span>
      </div>

      {group(readings, slots).map((day) => (
        <section key={day.date}>
          <h2 className="border-b border-stone-200 bg-white px-4 pt-5 pb-1 text-base font-semibold text-stone-900">
            {thaiDate(day.date)}
          </h2>

          {day.slots.map(({ slot, rows }) => (
            <div key={slot}>
              <div className="px-4 pt-2 pb-1 text-sm font-medium text-stone-600">
                {slotLabel(slot, slots)}
              </div>

              {rows.map((r) => (
                <button
                  key={r.id}
                  onClick={() => onSelect?.(r)}
                  className={
                    "flex w-full items-center gap-3 border-b border-stone-100 px-4 py-3 text-left " +
                    "active:bg-stone-100 " +
                    (r.needs_review
                      ? "border-l-4 border-l-amber-500 bg-amber-50/40 pl-3"
                      : "")
                  }
                >
                  <span className="w-12 text-sm text-stone-500">
                    {clockTime(r.taken_at)}
                  </span>
                  <span className="w-16 text-right text-xl font-semibold text-stone-900">
                    <Value v={r.sys} />
                  </span>
                  <span className="w-16 text-right text-xl font-semibold text-stone-900">
                    <Value v={r.dia} />
                  </span>
                  <span className="w-16 text-right text-xl text-stone-700">
                    <Value v={r.pulse} />
                  </span>

                  <span className="ml-auto flex items-center gap-2">
                    {r.irregular_flag && (
                      <span
                        className="text-stone-400"
                        title="เครื่องแจ้งจังหวะหัวใจไม่สม่ำเสมอ"
                        aria-label="เครื่องแจ้งจังหวะหัวใจไม่สม่ำเสมอ"
                      >
                        ♡
                      </span>
                    )}
                    {r.needs_review && (
                      <span className="rounded-sm bg-amber-500 px-1.5 py-0.5 text-[11px] font-medium text-white">
                        ตรวจสอบ
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}