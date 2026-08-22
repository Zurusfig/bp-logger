"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { initLiff, apiFetch, type LiffSession } from "@/lib/liff";
import { ReportSheet } from "@/components/report-sheet";
import { DEFAULT_SLOTS, type SlotDef } from "@/lib/slot";
import type { ReadingDto } from "@/app/api/readings/route";

type Payload = {
  readings: ReadingDto[];
  settings: {
    patient_name: string | null;
    last_visit_date: string | null;
    slots?: SlotDef[];
  } | null;
  range: { from: string; to: string };
};

const days = (n: number) =>
  new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);

export default function ReportPage() {
  const [session, setSession] = useState<LiffSession | null>(null);
  const [data, setData] = useState<Payload | null>(null);
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>(today());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sheet = useRef<HTMLDivElement>(null);

  useEffect(() => {
    initLiff()
      .then(setSession)
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  const load = useCallback(
    async (f?: string, t?: string) => {
      if (!session) return;
      const qs = new URLSearchParams({ from: f ?? from ?? days(30), to: t ?? to });
      try {
        const p = await apiFetch<Payload>(`/api/readings?${qs}`, session);
        setData(p);
        if (!from) setFrom(p.settings?.last_visit_date ?? days(30));
      } catch (e: any) {
        setError(String(e.message ?? e));
      }
    },
    [session, from, to]
  );

  useEffect(() => {
    if (!session) return;
    // First load uses the household's last visit date once it is known.
    load(from || undefined, to);
  }, [session, from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  async function savePng() {
    if (!sheet.current) return;
    setBusy(true);
    try {
      // html2canvas-pro, not html2canvas: Tailwind v4 emits oklch() colours that
      // the original library cannot parse and throws on.
      const { default: html2canvas } = await import("html2canvas-pro");
      const canvas = await html2canvas(sheet.current, {
        scale: 2,
        backgroundColor: "#ffffff",
      });
      const url = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = url;
      a.download = `ความดัน_${from}_${to}.png`;
      a.click();
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
    setBusy(false);
  }

  async function setLastVisitToday() {
    if (!session) return;
    await apiFetch("/api/settings", session, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ last_visit_date: today() }),
    });
    setFrom(today());
  }

  if (error) {
    return (
      <main className="mx-auto max-w-lg p-6">
        <p className="text-sm text-stone-600">{error}</p>
      </main>
    );
  }
  if (!data) {
    return <main className="mx-auto max-w-lg p-6 text-stone-500">กำลังโหลด</main>;
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl bg-stone-100 pb-24">
      <div className="no-print space-y-3 px-4 pt-4">
        <div className="flex gap-2">
          <label className="flex-1 text-sm">
            <span className="block text-stone-500">ตั้งแต่</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full rounded-md border border-stone-300 bg-white px-2 py-2"
            />
          </label>
          <label className="flex-1 text-sm">
            <span className="block text-stone-500">ถึง</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full rounded-md border border-stone-300 bg-white px-2 py-2"
            />
          </label>
        </div>

        <div className="flex gap-2 text-sm">
          <button
            onClick={() => setFrom(days(30))}
            className="rounded-full border border-stone-300 bg-white px-3 py-1.5"
          >
            30 วัน
          </button>
          <button
            onClick={() => setFrom(days(90))}
            className="rounded-full border border-stone-300 bg-white px-3 py-1.5"
          >
            3 เดือน
          </button>
          {data.settings?.last_visit_date && (
            <button
              onClick={() => setFrom(data.settings!.last_visit_date!)}
              className="rounded-full border border-stone-300 bg-white px-3 py-1.5"
            >
              ตั้งแต่พบหมอครั้งก่อน
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 bg-white shadow-sm print:shadow-none">
        <ReportSheet
          ref={sheet}
          readings={data.readings}
          slots={data.settings?.slots ?? DEFAULT_SLOTS}
          patientName={data.settings?.patient_name ?? null}
          from={from || data.range.from}
          to={to}
        />
      </div>

      <div className="no-print fixed inset-x-0 bottom-0 mx-auto flex max-w-3xl gap-2 border-t border-stone-300 bg-white p-4">
        <button
          onClick={savePng}
          disabled={busy}
          className="flex-1 rounded-md border border-stone-900 py-3 font-medium text-stone-900 disabled:opacity-50"
        >
          {busy ? "กำลังบันทึก" : "บันทึกรูป"}
        </button>
        <button
          onClick={() => window.print()}
          className="flex-1 rounded-md bg-stone-900 py-3 font-medium text-white"
        >
          พิมพ์
        </button>
        <button
          onClick={setLastVisitToday}
          className="rounded-md border border-stone-300 px-3 py-3 text-sm text-stone-600"
        >
          พบหมอวันนี้
        </button>
      </div>
    </main>
  );
}