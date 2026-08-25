"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, X } from "lucide-react";
import { initLiff, apiFetch, isInLiffClient, openExternally, type LiffSession } from "@/lib/liff";
import { Nav } from "@/components/nav";
import { ReportSheet } from "@/components/report-sheet";
import { ReportTable } from "@/components/report-table";
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

function chipClass(active: boolean): string {
  return (
    "rounded-full border px-3 py-1.5 transition-colors duration-150 " +
    (active
      ? "border-ink bg-white font-medium text-ink"
      : "border-rule-strong bg-white text-ink-muted")
  );
}

function groupLabelClass(): string {
  return "text-[12px] font-medium tracking-wide text-ink-faint";
}

function ReportInner() {
  const params = useSearchParams();

  const [session, setSession] = useState<LiffSession | null>(null);
  const [data, setData] = useState<Payload | null>(null);
  const [from, setFrom] = useState<string>(params.get("from") ?? "");
  const [to, setTo] = useState<string>(params.get("to") ?? today());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [view, setView] = useState<"sheet" | "table">("sheet");
  const [order, setOrder] = useState<"newest" | "oldest">("newest");
  const [showTime, setShowTime] = useState(true);
  const [showLabel, setShowLabel] = useState(true);
  const [showPulse, setShowPulse] = useState(true);
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
    // First load uses the household's last visit date once it is known,
    // unless a range already arrived via the URL (see handlePrint).
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

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!blob) throw new Error("สร้างรูปไม่สำเร็จ");
      const url = URL.createObjectURL(blob);

      // LINE's in-app browser, and iOS Safari to a lesser extent, do not
      // reliably honour <a download> — the tap silently does nothing. Showing
      // the image lets the user save it with the universal long-press gesture
      // instead of a download that may never fire.
      if (isInLiffClient()) {
        setPreview(url);
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.download = `ความดัน_${from}_${to}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
    setBusy(false);
  }

  function handlePrint() {
    // The embedded WebView LINE opens LIFF apps in commonly has no print UI at
    // all, so window.print() is a silent no-op there. Hand off to the device's
    // real browser instead, carrying the selected range along in the URL.
    if (isInLiffClient()) {
      const url = new URL(window.location.href);
      url.searchParams.set("from", from || data?.range.from || days(30));
      url.searchParams.set("to", to);
      openExternally(url.toString());
    } else {
      window.print();
    }
  }

  function closePreview() {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
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

      <div className="no-print flex gap-5 border-b border-rule px-4 text-[15px]">
        <button
          onClick={() => setView("sheet")}
          className={
            "flex min-h-11 items-center border-b-2 transition-colors duration-150 " +
            (view === "sheet" ? "border-ink font-medium text-ink" : "border-transparent text-ink-muted")
          }
        >
          แผ่นสำหรับหมอ
        </button>
        <button
          onClick={() => setView("table")}
          className={
            "flex min-h-11 items-center border-b-2 transition-colors duration-150 " +
            (view === "table" ? "border-ink font-medium text-ink" : "border-transparent text-ink-muted")
          }
        >
          ตารางบันทึก
        </button>
      </div>

      <div className="no-print space-y-3 px-4 pt-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="text-[15px]">
            <span className="block text-ink-muted">ตั้งแต่</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full rounded-md border border-rule-strong bg-white px-2 py-2"
            />
          </label>
          <label className="text-[15px]">
            <span className="block text-ink-muted">ถึง</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full rounded-md border border-rule-strong bg-white px-2 py-2"
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-2 text-[15px]">
          <button onClick={() => setFrom(days(30))} className={chipClass(from === days(30))}>
            30 วัน
          </button>
          <button onClick={() => setFrom(days(90))} className={chipClass(from === days(90))}>
            3 เดือน
          </button>
          {data.settings?.last_visit_date && (
            <button
              onClick={() => setFrom(data.settings!.last_visit_date!)}
              className={chipClass(from === data.settings.last_visit_date)}
            >
              ตั้งแต่พบหมอครั้งก่อน
            </button>
          )}
        </div>

        {view === "table" && (
          <div className="space-y-3 border-t border-rule pt-3">
            <div className="space-y-1.5">
              <p className={groupLabelClass()}>เรียงลำดับ</p>
              <div className="flex flex-wrap gap-2 text-[15px]">
                <button onClick={() => setOrder("newest")} className={chipClass(order === "newest")}>
                  ล่าสุดก่อน
                </button>
                <button onClick={() => setOrder("oldest")} className={chipClass(order === "oldest")}>
                  เก่าสุดก่อน
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <p className={groupLabelClass()}>แสดงข้อมูล</p>
              <div className="flex flex-wrap gap-x-4 gap-y-2 text-[15px] text-ink-muted">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={showTime}
                    onChange={(e) => setShowTime(e.target.checked)}
                    className="h-4 w-4 rounded border-rule-strong accent-ink"
                  />
                  เวลา
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={showLabel}
                    onChange={(e) => setShowLabel(e.target.checked)}
                    className="h-4 w-4 rounded border-rule-strong accent-ink"
                  />
                  ช่วงเวลา
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={showPulse}
                    onChange={(e) => setShowPulse(e.target.checked)}
                    className="h-4 w-4 rounded border-rule-strong accent-ink"
                  />
                  ชีพจร
                </label>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 overflow-x-auto border-y border-rule bg-white print:overflow-visible print:border-none">
        {view === "sheet" ? (
          <ReportSheet
            ref={sheet}
            readings={data.readings}
            slots={data.settings?.slots ?? DEFAULT_SLOTS}
            patientName={data.settings?.patient_name ?? null}
            from={from || data.range.from}
            to={to}
          />
        ) : (
          <ReportTable
            ref={sheet}
            readings={data.readings}
            slots={data.settings?.slots ?? DEFAULT_SLOTS}
            patientName={data.settings?.patient_name ?? null}
            from={from || data.range.from}
            to={to}
            order={order}
            showTime={showTime}
            showLabel={showLabel}
            showPulse={showPulse}
          />
        )}
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
          onClick={handlePrint}
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

      {preview && (
        <div
          className="no-print fixed inset-0 z-50 flex flex-col bg-ink/60"
          onClick={closePreview}
        >
          <div className="flex items-center justify-between p-4">
            <p className="text-[15px] font-medium text-paper">กดค้างที่รูปเพื่อบันทึกลงเครื่อง</p>
            <button
              onClick={closePreview}
              className="flex h-11 w-11 items-center justify-center text-paper"
              aria-label="ปิด"
            >
              <X size={18} strokeWidth={1.5} />
            </button>
          </div>
          <div className="flex flex-1 items-center justify-center overflow-auto p-4">
            <img
              src={preview}
              alt="รูปสรุปสำหรับหมอ"
              className="max-h-full max-w-full rounded"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}
    </main>
  );
}

export default function ReportPage() {
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense fallback={<main className="min-h-screen bg-paper" />}>
      <ReportInner />
    </Suspense>
  );
}
