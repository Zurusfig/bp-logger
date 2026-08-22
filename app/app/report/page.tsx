"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { initLiff, apiFetch, type LiffSession } from "@/lib/liff";
import { Nav } from "@/components/nav";
import { ReportSheet } from "@/components/report-sheet";
import { ReportSheetSkeleton } from "@/components/skeleton";
import { useDelayedFlag } from "@/lib/use-delayed-flag";
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
  const loading = useDelayedFlag(!data && !error);

  useEffect(() => {
    initLiff()
      .then(setSession)
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  const load = useCallback(
    async (f?: string, t?: string) => {
      if (!session) return;
      const qs = new URLSearchParams({ from: f || days(30), to: t || today() });
      try {
        const p = await apiFetch<Payload>(`/api/readings?${qs}`, session);
        setData(p);
        if (!from) setFrom(p.settings?.last_visit_date ?? days(30));
      } catch (e: any) {
        setError(String(e.message ?? e));
      }
    },
    [session, from, to],
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
      const el = sheet.current;
      // The sheet is width:100% so it never grows past its scrollable wrapper;
      // html2canvas only captures the element's own box, so a report wide enough
      // to overflow (many slot columns) gets silently cropped unless we expand
      // it to its full content width first.
      const prevWidth = el.style.width;
      el.style.width = `${el.scrollWidth}px`;
      let canvas;
      try {
        canvas = await html2canvas(el, {
          scale: 2,
          backgroundColor: "#ffffff",
        });
      } finally {
        el.style.width = prevWidth;
      }
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
        <p className="text-[15px] font-medium text-ink">{error}</p>
      </main>
    );
  }
  if (!data) {
    if (!loading) return null;
    return (
      <main className="mx-auto min-h-screen w-full max-w-3xl bg-paper pb-24">
        <Nav />
        <div className="mt-4">
          <ReportSheetSkeleton />
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl bg-paper pb-24">
      <Nav />

      <div className="no-print space-y-3 px-4 pt-4">
        <div className="flex gap-2">
          <label className="flex-1 text-[15px]">
            <span className="block text-ink-muted">ตั้งแต่</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full rounded-md border border-rule-strong bg-white px-2 py-2"
            />
          </label>
          <label className="flex-1 text-[15px]">
            <span className="block text-ink-muted">ถึง</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full rounded-md border border-rule-strong bg-white px-2 py-2"
            />
          </label>
        </div>

        <div className="flex gap-2 text-[15px]">
          <button
            onClick={() => setFrom(days(30))}
            className="rounded-full border border-rule-strong bg-white px-3 py-1.5 transition-colors duration-150"
          >
            30 วัน
          </button>
          <button
            onClick={() => setFrom(days(90))}
            className="rounded-full border border-rule-strong bg-white px-3 py-1.5 transition-colors duration-150"
          >
            3 เดือน
          </button>
          {data.settings?.last_visit_date && (
            <button
              onClick={() => setFrom(data.settings!.last_visit_date!)}
              className="rounded-full border border-rule-strong bg-white px-3 py-1.5 transition-colors duration-150"
            >
              ตั้งแต่พบหมอครั้งก่อน
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 overflow-x-auto border-y border-rule bg-white print:overflow-visible print:border-none">
        <ReportSheet
          ref={sheet}
          readings={data.readings}
          slots={data.settings?.slots ?? DEFAULT_SLOTS}
          patientName={data.settings?.patient_name ?? null}
          from={from || data.range.from}
          to={to}
        />
      </div>

      <div className="no-print fixed inset-x-0 bottom-0 mx-auto flex max-w-3xl gap-2 border-t border-rule bg-white p-4">
        <button
          onClick={savePng}
          disabled={busy}
          className="flex flex-1 items-center justify-center gap-2 rounded-md border border-ink py-3 font-medium text-ink disabled:opacity-50"
        >
          {busy && <Loader2 size={16} strokeWidth={1.5} className="animate-spin" aria-hidden="true" />}
          {busy ? "กำลังบันทึก" : "บันทึกรูป"}
        </button>
        <button
          onClick={() => window.print()}
          className="flex-1 rounded-md bg-ink py-3 font-medium text-paper"
        >
          พิมพ์
        </button>
        <button
          onClick={setLastVisitToday}
          className="min-h-11 rounded-md border border-rule-strong px-3 py-3 text-[15px] text-ink-muted"
        >
          พบหมอวันนี้
        </button>
      </div>
    </main>
  );
}
