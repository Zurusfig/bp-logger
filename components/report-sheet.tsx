"use client";

import { forwardRef } from "react";
import type { ReadingDto } from "@/app/api/readings/route";
import { normalise, type SlotDef } from "@/lib/slot";
import { INK, INK_MUTED, INK_FAINT, RULE, HEADER_TINT, thaiDate, thaiFull, bkkTime } from "@/lib/report-format";

/**
 * The doctor's sheet. Days run down the page, slots across it, which is how paper
 * blood-pressure diaries are laid out and what keeps a month inside one A4 page.
 * A flat one-row-per-reading table would run to three pages for the same range.
 * For that flat layout instead, see ReportTable.
 */

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

  const border = `1px solid ${RULE}`;
  const th: React.CSSProperties = {
    border,
    padding: "4px 6px",
    fontWeight: 600,
    fontSize: "11pt",
    lineHeight: 1.5,
    background: HEADER_TINT,
    color: INK,
    textAlign: "center",
  };
  const td: React.CSSProperties = {
    border,
    padding: "3px 6px",
    fontSize: "11pt",
    lineHeight: 1.45,
    textAlign: "center",
    verticalAlign: "top",
    fontVariantNumeric: "tabular-nums",
  };

  return (
    <div
      ref={ref}
      style={{
        background: "#ffffff",
        color: INK,
        padding: "16px",
        width: "100%",
        lineHeight: 1.5,
        // References the CSS variable next/font generates (see app/layout.tsx),
        // not a literal family name: "Anuphan" is self-hosted under a hashed
        // font-family, so naming it directly here would silently fall through
        // to the system default instead of the loaded webfont.
        fontFamily: "var(--font-sans)",
      }}
    >
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: "16pt", fontWeight: 700 }}>
          บันทึกความดันโลหิต{patientName ? ` ${patientName}` : ""}
        </div>
        <div style={{ fontSize: "11pt", marginTop: 4, color: INK_MUTED }}>
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
                      <span style={{ color: INK_FAINT }}>-</span>
                    ) : (
                      rows.map((r) => (
                        <div key={r.id} style={{ whiteSpace: "nowrap" }}>
                          <span style={{ fontSize: "12pt", fontWeight: 600, color: INK }}>
                            {r.sys ?? "?"}/{r.dia ?? "?"}
                          </span>{" "}
                          <span style={{ color: INK_MUTED }}>({r.pulse ?? "?"})</span>
                          {r.needs_review ? "*" : ""}
                          <span style={{ color: INK_FAINT }}> {bkkTime(r.taken_at)}</span>
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

      <div style={{ marginTop: 10, fontSize: "11pt", color: INK_MUTED }}>
        ตัวเลขในวงเล็บคือชีพจร
        {pending > 0 ? ` เครื่องหมาย * คือรายการที่ยังไม่ได้ตรวจสอบ (${pending} รายการ)` : ""}
      </div>
    </div>
  );
});
