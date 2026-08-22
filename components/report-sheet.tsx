"use client";

import { forwardRef } from "react";
import type { ReadingDto } from "@/app/api/readings/route";
import { normalise, type SlotDef } from "@/lib/slot";

/**
 * The doctor's sheet. Days run down the page, slots across it, which is how paper
 * blood-pressure diaries are laid out and what keeps a month inside one A4 page.
 * A flat one-row-per-reading table would run to three pages for the same range.
 *
 * Colours are hex on purpose: this element is rasterised to PNG, and the canvas
 * library cannot parse the oklch() values Tailwind emits.
 */

const TH_MONTHS = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

function thaiDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${TH_MONTHS[m - 1]}`;
}

function thaiFull(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${TH_MONTHS[m - 1]} ${y + 543}`;
}

const bkkTime = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));

export type ReportProps = {
  readings: ReadingDto[];
  slots: SlotDef[];
  patientName: string | null;
  from: string;
  to: string;
};

export const ReportSheet = forwardRef<HTMLDivElement, ReportProps>(function ReportSheet(
  { readings, slots, patientName, from, to },
  ref
) {
  const defs = normalise(slots);

  // date -> slot key -> readings
  const byDate = new Map<string, Map<string, ReadingDto[]>>();
  for (const r of readings) {
    const date = r.reading_date ?? r.taken_at.slice(0, 10);
    if (!byDate.has(date)) byDate.set(date, new Map());
    const m = byDate.get(date)!;
    const key = r.slot ?? defs[0].key;
    if (!m.has(key)) m.set(key, []);
    m.get(key)!.push(r);
  }

  const dates = [...byDate.keys()].sort(); // oldest first, as a diary reads
  const pending = readings.filter((r) => r.needs_review).length;

  const border = "1px solid #c9c9c4";
  const th: React.CSSProperties = {
    border,
    padding: "4px 6px",
    fontWeight: 600,
    fontSize: "11pt",
    background: "#f0efec",
    textAlign: "center",
  };
  const td: React.CSSProperties = {
    border,
    padding: "3px 6px",
    fontSize: "11pt",
    textAlign: "center",
    verticalAlign: "top",
    fontVariantNumeric: "tabular-nums",
  };

  return (
    <div
      ref={ref}
      style={{
        background: "#ffffff",
        color: "#14140f",
        padding: "16px",
        width: "100%",
        fontFamily:
          '"Noto Sans Thai", "Sarabun", -apple-system, "Helvetica Neue", sans-serif',
      }}
    >
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: "15pt", fontWeight: 700 }}>
          บันทึกความดันโลหิต{patientName ? ` ${patientName}` : ""}
        </div>
        <div style={{ fontSize: "11pt", marginTop: 2 }}>
          {thaiFull(from)} ถึง {thaiFull(to)} รวม {readings.length} ครั้ง
        </div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ ...th, width: "70px" }}>วันที่</th>
            {defs.map((s) => (
              <th key={s.key} style={th}>
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dates.map((date) => (
            <tr key={date}>
              <td style={{ ...td, textAlign: "left", whiteSpace: "nowrap" }}>
                {thaiDate(date)}
              </td>
              {defs.map((s) => {
                const rows = byDate.get(date)?.get(s.key) ?? [];
                return (
                  <td key={s.key} style={td}>
                    {rows.length === 0 ? (
                      <span style={{ color: "#b6b6b0" }}>-</span>
                    ) : (
                      rows.map((r) => (
                        <div key={r.id} style={{ whiteSpace: "nowrap" }}>
                          <span style={{ fontWeight: 600 }}>
                            {r.sys ?? "?"}/{r.dia ?? "?"}
                          </span>{" "}
                          <span style={{ color: "#4a4a44" }}>({r.pulse ?? "?"})</span>
                          {r.needs_review ? "*" : ""}
                          <span style={{ color: "#8a8a84", fontSize: "9pt" }}>
                            {" "}
                            {bkkTime(r.taken_at)}
                          </span>
                        </div>
                      ))
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: 8, fontSize: "9.5pt", color: "#4a4a44" }}>
        ตัวเลขในวงเล็บคือชีพจร
        {pending > 0 ? ` เครื่องหมาย * คือรายการที่ยังไม่ได้ตรวจสอบ (${pending} รายการ)` : ""}
      </div>
    </div>
  );
});