"use client";

import { forwardRef } from "react";
import type { ReadingDto } from "@/app/api/readings/route";
import { slotLabel, type SlotDef } from "@/lib/slot";
import { INK, INK_MUTED, INK_FAINT, RULE, HEADER_TINT, thaiDate, thaiFull, bkkTime } from "@/lib/report-format";

/**
 * The traditional two-column log some doctors still ask for: one row per
 * reading, running date-then-time down the page, instead of ReportSheet's
 * date-by-slot grid. Rows come straight from `readings`, so a slot nobody
 * logged simply has no row here — nothing to mark as missed.
 */

export type ReportTableProps = {
  readings: ReadingDto[];
  slots: SlotDef[];
  patientName: string | null;
  from: string;
  to: string;
  order: "newest" | "oldest";
  showTime: boolean;
  showLabel: boolean;
  showPulse: boolean;
};

export const ReportTable = forwardRef<HTMLDivElement, ReportTableProps>(function ReportTable(
  { readings, slots, patientName, from, to, order, showTime, showLabel, showPulse },
  ref
) {
  const rows = [...readings].sort((a, b) => {
    const diff = new Date(a.taken_at).getTime() - new Date(b.taken_at).getTime();
    return order === "oldest" ? diff : -diff;
  });
  const pending = readings.filter((r) => r.needs_review).length;

  const border = `1px solid ${RULE}`;
  const th: React.CSSProperties = {
    border,
    padding: "6px 10px",
    fontWeight: 600,
    fontSize: "11pt",
    lineHeight: 1.5,
    background: HEADER_TINT,
    color: INK,
    textAlign: "left",
  };
  const td: React.CSSProperties = {
    border,
    padding: "5px 10px",
    fontSize: "11pt",
    lineHeight: 1.5,
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
            <th style={{ ...th, width: "120px" }}>วันที่/เวลา</th>
            <th style={th}>ค่าที่วัดได้</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const date = r.reading_date ?? r.taken_at.slice(0, 10);
            const prevDate = i > 0 ? (rows[i - 1].reading_date ?? rows[i - 1].taken_at.slice(0, 10)) : null;
            // A heavier rule where the date changes (over the thin RULE grid
            // lines used everywhere else) marks day boundaries even though
            // several readings from the same day share consecutive rows.
            const dayTd = i > 0 && date !== prevDate ? { ...td, borderTop: `2px solid ${INK_FAINT}` } : td;
            return (
              <tr key={r.id}>
                <td style={{ ...dayTd, whiteSpace: "nowrap" }}>
                  {thaiDate(date)}
                  {showTime && <span style={{ color: INK_MUTED }}> · {bkkTime(r.taken_at)}</span>}
                  {showLabel && (
                    <div style={{ fontSize: "10pt", color: INK_FAINT }}>{slotLabel(r.slot, slots)}</div>
                  )}
                </td>
                <td style={dayTd}>
                  <span style={{ fontSize: "12pt", fontWeight: 600, color: INK }}>
                    {r.sys ?? "?"}/{r.dia ?? "?"}
                  </span>
                  {showPulse && <span style={{ color: INK_MUTED }}> ({r.pulse ?? "?"})</span>}
                  {r.needs_review ? "*" : ""}
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td style={{ ...td, color: INK_FAINT }} colSpan={2}>
                ยังไม่มีข้อมูลในช่วงนี้
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div style={{ marginTop: 10, fontSize: "11pt", color: INK_MUTED }}>
        {showPulse ? "ตัวเลขในวงเล็บคือชีพจร" : ""}
        {pending > 0 ? ` เครื่องหมาย * คือรายการที่ยังไม่ได้ตรวจสอบ (${pending} รายการ)` : ""}
      </div>
    </div>
  );
});
