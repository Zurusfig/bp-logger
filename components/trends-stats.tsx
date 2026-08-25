import type { WeeklyMean } from "@/lib/trends";

function fmt(n: number | null, digits = 0): string {
  return n == null ? "–" : n.toFixed(digits);
}

function DeltaText({ delta }: { delta: number | null }) {
  if (delta == null) return <span className="text-ink-faint">–</span>;
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "±";
  return (
    <span className="tabular-nums text-ink-muted">
      {sign}
      {Math.abs(delta).toFixed(1)}
    </span>
  );
}

/**
 * Plain numbers, not charts — and nothing here animates. This is the one
 * part of the page meant to be read at a glance rather than browsed.
 */
export function TrendsStats({
  weekly,
  compliance,
  spread,
}: {
  weekly: WeeklyMean[];
  compliance: { logged: number; expected: number };
  spread: { mean: number | null; sessions: number };
}) {
  return (
    <section className="space-y-5 border-t border-rule px-4 py-4 text-[15px]">
      <div>
        <p className="mb-2 text-[12px] font-medium tracking-wide text-ink-faint">
          ค่าเฉลี่ย SYS สัปดาห์นี้เทียบกับสัปดาห์ก่อน
        </p>
        <div className="space-y-1.5">
          {weekly.map((w) => (
            <div key={w.def.key} className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: w.color }}
                aria-hidden="true"
              />
              <span className="w-24 shrink-0 truncate text-ink-muted">{w.def.label}</span>
              <span className="tabular-nums text-ink">{fmt(w.thisWeek, 1)}</span>
              <span className="tabular-nums text-ink-faint">จาก {fmt(w.lastWeek, 1)}</span>
              <DeltaText delta={w.delta} />
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-baseline justify-between border-t border-rule pt-3">
        <span className="text-ink-muted">บันทึกสัปดาห์นี้</span>
        <span className="tabular-nums text-ink">
          {compliance.logged} จาก {compliance.expected} ครั้ง
        </span>
      </div>

      <div className="flex items-baseline justify-between border-t border-rule pt-3">
        <span className="text-ink-muted">ส่วนต่าง SYS ระหว่าง 2 ครั้งต่อรอบ</span>
        <span className="tabular-nums text-ink">
          {spread.mean == null ? "–" : `${spread.mean.toFixed(1)} มม.ปรอท`}
          {spread.sessions > 0 && <span className="ml-1 text-ink-faint">({spread.sessions} รอบ)</span>}
        </span>
      </div>
    </section>
  );
}
