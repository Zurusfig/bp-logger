"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { initLiff, apiFetch, type LiffSession } from "@/lib/liff";
import { Nav } from "@/components/nav";
import { SlotCharts } from "@/components/trends-slot-charts";
import { TimeOfDayScatter } from "@/components/trends-scatter";
import { TrendsStats } from "@/components/trends-stats";
import { TrendsSkeleton } from "@/components/skeleton";
import { useDelayedFlag } from "@/lib/use-delayed-flag";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { DEFAULT_SLOTS, type SlotDef } from "@/lib/slot";
import {
  bySlot,
  timeOfDay,
  weeklyMeans,
  compliance as computeCompliance,
  withinSessionSpread,
  excludedCount,
  eligible,
} from "@/lib/trends";
import type { ReadingDto } from "@/app/api/readings/route";

/**
 * A secondary, browse-only surface: the table at /app and the printable
 * sheet at /app/report are the product. This page never edits, reviews, or
 * exports anything — it only visualises what's already been logged there.
 */

type Payload = {
  readings: ReadingDto[];
  settings: { slots?: SlotDef[] } | null;
  range: { from: string; to: string };
};

const RANGES = [
  { key: "30", label: "30 วัน" },
  { key: "90", label: "3 เดือน" },
  { key: "all", label: "ทั้งหมด" },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

const days = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
function fromDate(key: RangeKey): string {
  if (key === "30") return days(30);
  if (key === "90") return days(90);
  return "2000-01-01";
}

const MIN_READINGS_FOR_CHARTS = 10;

export default function TrendsPage() {
  const [session, setSession] = useState<LiffSession | null>(null);
  const [data, setData] = useState<Payload | null>(null);
  const [range, setRange] = useState<RangeKey>("30");
  const [error, setError] = useState<string | null>(null);
  const [loadNonce, setLoadNonce] = useState(0);
  const [chartDuration, setChartDuration] = useState(400);
  const loading = useDelayedFlag(!data && !error);
  const reducedMotion = usePrefersReducedMotion();
  const hasLoadedOnce = useRef(false);

  useEffect(() => {
    initLiff()
      .then(setSession)
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  const load = useCallback(() => {
    if (!session) return;
    const qs = new URLSearchParams({ from: fromDate(range) });
    apiFetch<Payload>(`/api/readings?${qs}`, session)
      .then((p) => {
        setData(p);
        setLoadNonce((n) => n + 1);
        // First paint gets the longer "on data load" animation (400ms); every
        // later load — a range chip change — gets the shorter re-animate (250ms).
        setChartDuration(hasLoadedOnce.current ? 250 : 400);
        hasLoadedOnce.current = true;
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, [session, range]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <main className="mx-auto max-w-lg p-6">
        <p className="text-[15px] font-medium text-ink">{error}</p>
      </main>
    );
  }

  if (!data) {
    if (!loading) return null;
    return (
      <main className="mx-auto min-h-screen w-full max-w-3xl bg-paper pb-24 print:hidden">
        <Nav />
        <TrendsSkeleton />
      </main>
    );
  }

  const slots = data.settings?.slots?.length ? data.settings.slots : DEFAULT_SLOTS;
  const excluded = excludedCount(data.readings);
  const validReadings = eligible(data.readings);
  const showCharts = validReadings.length >= MIN_READINGS_FOR_CHARTS;

  const slotSeries = bySlot(data.readings, slots);
  const scatterSeries = timeOfDay(data.readings, slots);
  const weekly = weeklyMeans(data.readings, slots);
  const comp = computeCompliance(data.readings, slots);
  const spread = withinSessionSpread(data.readings);

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl bg-paper pb-24 print:hidden">
      <Nav />

      <div className="flex gap-2 overflow-x-auto border-b border-rule px-4 py-3">
        {RANGES.map((r) => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            className={
              "shrink-0 rounded-full border px-3 py-1.5 text-[15px] transition-colors duration-150 " +
              (range === r.key ? "border-ink bg-white font-medium text-ink" : "border-rule-strong text-ink-muted")
            }
          >
            {r.label}
          </button>
        ))}
      </div>

      {validReadings.length === 0 ? (
        <p className="px-4 py-16 text-center text-[15px] text-ink-muted">ยังไม่มีข้อมูลในช่วงนี้</p>
      ) : (
        <>
          {showCharts ? (
            <>
              <SlotCharts
                key={`slots-${loadNonce}`}
                series={slotSeries.series}
                tDomain={slotSeries.tDomain}
                yDomain={slotSeries.yDomain}
                duration={chartDuration}
                reducedMotion={reducedMotion}
              />

              <section className="border-b border-rule px-4 pt-3 pb-2">
                <p className="text-[13px] font-medium text-ink-muted">ช่วงเวลาในหนึ่งวัน</p>
                <TimeOfDayScatter
                  key={`scatter-${loadNonce}`}
                  series={scatterSeries}
                  yDomain={slotSeries.yDomain}
                  duration={chartDuration}
                  delay={slots.length * 80}
                  reducedMotion={reducedMotion}
                />
              </section>
            </>
          ) : (
            <p className="border-b border-rule px-4 py-4 text-[14px] text-ink-faint">
              กราฟจะแสดงเมื่อมีข้อมูลมากขึ้น
            </p>
          )}

          <TrendsStats weekly={weekly} compliance={comp} spread={spread} />
        </>
      )}

      {excluded > 0 && (
        <p className="px-4 pb-6 text-[13px] text-ink-faint">{excluded} รายการรอตรวจสอบ ไม่รวมในกราฟ</p>
      )}
    </main>
  );
}
