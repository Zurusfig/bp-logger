"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { initLiff, apiFetch, type LiffSession } from "@/lib/liff";
import { ReadingsTable } from "@/components/readings-table";
import { ReadingDetail } from "@/components/reading-detail";
import type { ReadingDto } from "@/app/api/readings/route";

type Payload = {
  readings: ReadingDto[];
  members: Record<string, string>;
  settings: { patient_name: string | null; last_visit_date: string | null } | null;
  range: { from: string; to: string };
  review_count: number;
};

const RANGES = [
  { key: "visit", label: "ตั้งแต่พบหมอครั้งก่อน" },
  { key: "30", label: "30 วัน" },
  { key: "90", label: "3 เดือน" },
  { key: "all", label: "ทั้งหมด" },
] as const;

type RangeKey = (typeof RANGES)[number]["key"];

function fromDate(key: RangeKey, lastVisit: string | null): string {
  const days = (n: number) =>
    new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
  if (key === "visit") return lastVisit ?? days(30);
  if (key === "30") return days(30);
  if (key === "90") return days(90);
  return "2000-01-01";
}

function AppInner() {
  const params = useSearchParams();
  const deepLinkId = params.get("id");

  const [session, setSession] = useState<LiffSession | null>(null);
  const [data, setData] = useState<Payload | null>(null);
  const [range, setRange] = useState<RangeKey>(deepLinkId ? "all" : "visit");
  const [reviewOnly, setReviewOnly] = useState(false);
  const [selected, setSelected] = useState<ReadingDto | null>(null);
  const [deepLinkDone, setDeepLinkDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    initLiff()
      .then(setSession)
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  const load = useCallback(() => {
    if (!session) return;
    const from = fromDate(range, data?.settings?.last_visit_date ?? null);
    const qs = new URLSearchParams({ from, ...(reviewOnly ? { review: "1" } : {}) });

    apiFetch<Payload>(`/api/readings?${qs}`, session)
      .then(setData)
      .catch((e) => setError(String(e.message ?? e)));
    // data.settings is deliberately not a dependency: refetching when it arrives
    // would loop. The range control re-queries once a last-visit date exists.
  }, [session, range, reviewOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
  }, [load]);

  // Opened from a bot message: jump straight to that reading, once.
  useEffect(() => {
    if (!deepLinkId || deepLinkDone || !data) return;
    const match = data.readings.find((r) => r.id === deepLinkId);
    if (match) setSelected(match);
    setDeepLinkDone(true);
  }, [deepLinkId, deepLinkDone, data]);

  if (error) {
    return (
      <main className="mx-auto max-w-lg p-6">
        <h1 className="mb-2 text-lg font-semibold">เปิดข้อมูลไม่ได้</h1>
        <p className="text-sm text-stone-600">{error}</p>
        <p className="mt-4 text-sm text-stone-500">
          ถ้ายังไม่เคยส่งรูปในกลุ่ม ให้ส่งรูปหนึ่งครั้งก่อน แล้วเปิดใหม่
        </p>
      </main>
    );
  }

  if (!data) {
    return <main className="mx-auto max-w-lg p-6 text-stone-500">กำลังโหลด</main>;
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-lg bg-white pb-16 text-stone-900 lg:max-w-3xl">
      <header className="border-b border-stone-300 px-4 pt-4 pb-3">
        <div className="flex items-baseline justify-between">
          <h1 className="text-lg font-semibold">
            {data.settings?.patient_name ?? "ความดันโลหิต"}
          </h1>
          <span className="text-sm text-stone-500">{data.readings.length} ครั้ง</span>
        </div>

        <div className="mt-3 flex gap-2 overflow-x-auto">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={
                "shrink-0 rounded-full border px-3 py-1.5 text-sm " +
                (range === r.key
                  ? "border-stone-900 bg-stone-900 text-white"
                  : "border-stone-300 text-stone-600")
              }
            >
              {r.label}
            </button>
          ))}
        </div>

        {(data.review_count > 0 || reviewOnly) && (
          <button
            onClick={() => setReviewOnly((v) => !v)}
            className={
              "mt-3 flex w-full items-center gap-2 rounded-md border px-3 py-2 text-sm " +
              (reviewOnly
                ? "border-amber-600 bg-amber-500 text-white"
                : "border-amber-300 bg-amber-50 text-amber-900")
            }
          >
            <span className="font-medium">
              {reviewOnly
                ? `แสดง ${data.readings.length} รายการที่รอตรวจสอบ`
                : `${data.review_count} รายการรอตรวจสอบ`}
            </span>
            <span className="ml-auto text-xs opacity-80">
              {reviewOnly ? "แสดงทั้งหมด" : "ดูเฉพาะรายการนี้"}
            </span>
          </button>
        )}
      </header>

      <ReadingsTable readings={data.readings} onSelect={setSelected} />

      {selected && session && (
        <ReadingDetail
          reading={selected}
          session={session}
          members={data.members}
          onClose={() => setSelected(null)}
          onChanged={load}
        />
      )}
    </main>
  );
}

export default function AppPage() {
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense fallback={<main className="p-6 text-stone-500">กำลังโหลด</main>}>
      <AppInner />
    </Suspense>
  );
}