"use client";

import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { apiFetch, type LiffSession } from "@/lib/liff";
import { Skeleton } from "@/components/skeleton";
import type { ReadingDto } from "@/app/api/readings/route";
import { DEFAULT_SLOTS, slotLabel, type SlotDef } from "@/lib/slot";

type Detail = ReadingDto & {
  image_url: string | null;
  ocr_raw: { observations?: string } | null;
  edited_by: string | null;
  reviewed_by: string | null;
};

const bkk = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", ...opts }).format(
    new Date(iso)
  );

/** datetime-local wants a local wall-clock string, not a UTC instant. */
function toLocalInput(iso: string): string {
  const d = bkk(iso, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const [date, time] = d.split(", ");
  const [dd, mm, yyyy] = date.split("/");
  return `${yyyy}-${mm}-${dd}T${time}`;
}

/** Bangkok is UTC+7 year round, so the offset can be appended literally. */
function fromLocalInput(v: string): string {
  return new Date(`${v}:00+07:00`).toISOString();
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex-1 border-r border-rule px-3 py-2 last:border-r-0">
      <span className="block text-[13px] text-ink-muted">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="—"
        className="w-full bg-transparent text-2xl font-semibold tabular-nums outline-none"
      />
    </label>
  );
}

export function ReadingDetail({
  reading,
  session,
  members,
  slots = DEFAULT_SLOTS,
  onClose,
  onChanged,
}: {
  reading: ReadingDto;
  session: LiffSession;
  members: Record<string, string>;
  slots?: SlotDef[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [editing, setEditing] = useState(false);
  const [busyAction, setBusyAction] = useState<"save" | "confirm" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [closing, setClosing] = useState(false);

  const [sys, setSys] = useState(reading.sys?.toString() ?? "");
  const [dia, setDia] = useState(reading.dia?.toString() ?? "");
  const [pulse, setPulse] = useState(reading.pulse?.toString() ?? "");
  const [takenAt, setTakenAt] = useState(toLocalInput(reading.taken_at));

  useEffect(() => {
    apiFetch<Detail>(`/api/readings/${reading.id}`, session)
      .then(setDetail)
      .catch((e) => setError(String(e.message ?? e)));
  }, [reading.id, session]);

  // Slides up from off-screen on mount, so the sheet visibly arrives from
  // the bottom rather than popping in.
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  function requestClose() {
    setClosing(true);
    setTimeout(onClose, 200);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && requestClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const r = detail ?? reading;
  const incomplete = !sys || !dia || !pulse;
  const busy = busyAction !== null;

  async function save() {
    setBusyAction("save");
    setError(null);
    try {
      await apiFetch(`/api/readings/${reading.id}`, session, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sys: sys ? Number(sys) : null,
          dia: dia ? Number(dia) : null,
          pulse: pulse ? Number(pulse) : null,
          taken_at: fromLocalInput(takenAt),
        }),
      });
      onChanged();
      requestClose();
    } catch (e: any) {
      setError(String(e.message ?? e));
      setBusyAction(null);
    }
  }

  async function confirm() {
    setBusyAction("confirm");
    try {
      await apiFetch(`/api/readings/${reading.id}/review`, session, { method: "POST" });
      onChanged();
      requestClose();
    } catch (e: any) {
      setError(String(e.message ?? e));
      setBusyAction(null);
    }
  }

  async function remove() {
    if (!window.confirm("ลบรายการนี้")) return;
    setBusyAction("delete");
    try {
      await apiFetch(`/api/readings/${reading.id}`, session, { method: "DELETE" });
      onChanged();
      requestClose();
    } catch (e: any) {
      setError(String(e.message ?? e));
      setBusyAction(null);
    }
  }

  const open = mounted && !closing;

  return (
    <div
      className={
        "fixed inset-0 z-50 flex flex-col bg-ink/40 transition-opacity duration-150 " +
        (open ? "opacity-100" : "opacity-0")
      }
      onClick={requestClose}
    >
      <div
        className={
          "mx-auto mt-auto max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-xl bg-white " +
          "transition-transform duration-200 ease-out " +
          (open ? "translate-y-0" : "translate-y-full")
        }
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-rule bg-white px-4 py-3">
          <div>
            <div className="text-[15px] font-medium text-ink">
              {bkk(r.taken_at, { day: "numeric", month: "short" })}{" "}
              {slotLabel(r.slot, slots)}{" "}
              {bkk(r.taken_at, { hour: "2-digit", minute: "2-digit", hour12: false })}
            </div>
            <div className="text-[13px] text-ink-muted">
              บันทึกโดย {members[r.sender_id] || "ไม่ทราบ"}
              {detail?.edited_by ? ` แก้ไขโดย ${members[detail.edited_by] || "ไม่ทราบ"}` : ""}
            </div>
          </div>
          <button
            onClick={requestClose}
            className="flex h-11 w-11 items-center justify-center text-ink-muted"
            aria-label="ปิด"
          >
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex border-b border-rule">
          {editing ? (
            <>
              <NumberField label="SYS" value={sys} onChange={setSys} />
              <NumberField label="DIA" value={dia} onChange={setDia} />
              <NumberField label="ชีพจร" value={pulse} onChange={setPulse} />
            </>
          ) : (
            <>
              {(["sys", "dia", "pulse"] as const).map((f) => (
                <div key={f} className="flex-1 border-r border-rule px-3 py-2 last:border-r-0">
                  <div className="text-[13px] text-ink-muted">
                    {f === "pulse" ? "ชีพจร" : f.toUpperCase()}
                  </div>
                  <div
                    className={
                      "tabular-nums " +
                      (f === "pulse"
                        ? "text-xl font-medium text-ink-muted"
                        : "text-2xl font-semibold text-ink")
                    }
                  >
                    {r[f] ?? <span className="text-ink-faint">—</span>}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        {editing && (
          <label className="block border-b border-rule px-4 py-3">
            <span className="block text-[13px] text-ink-muted">เวลาที่วัด</span>
            <input
              type="datetime-local"
              value={takenAt}
              onChange={(e) => setTakenAt(e.target.value)}
              className="w-full bg-transparent py-1 text-[15px] outline-none"
            />
          </label>
        )}

        {r.needs_review && !editing && (
          <div className="border-b border-accent/30 bg-accent-soft px-4 py-3 text-[15px] text-accent-strong">
            <div className="font-medium">รอการตรวจสอบ</div>
            <div className="mt-1">
              {r.review_note ||
                (r.confidence !== null
                  ? `เครื่องอ่านค่าได้ไม่ชัด ${Math.round(r.confidence * 100)}%`
                  : "ต้องยืนยันตัวเลข")}
            </div>
            <div className="mt-1">เทียบกับรูปด้านล่าง ถ้าตรงกดยืนยัน ถ้าไม่ตรงกดแก้ไข</div>
          </div>
        )}

        <div className="flex min-h-[46vh] items-center justify-center bg-paper p-4">
          {detail?.image_url ? (
            <img
              src={detail.image_url}
              alt="รูปหน้าจอเครื่องวัด"
              className="mx-auto max-h-[46vh] w-auto rounded"
            />
          ) : detail ? (
            <p className="text-[15px] text-ink-muted">ไม่มีรูป</p>
          ) : (
            <Skeleton className="h-full min-h-[40vh] w-full max-w-xs" />
          )}
        </div>

        {detail?.ocr_raw?.observations && !editing && (
          <details className="border-t border-rule px-4 py-3 text-[15px] text-ink-muted">
            <summary className="cursor-pointer text-ink-muted">รายละเอียดการอ่าน</summary>
            <p className="mt-2">{detail.ocr_raw.observations}</p>
          </details>
        )}

        {error && <p className="px-4 py-3 text-[15px] font-medium text-ink">{error}</p>}

        <div className="sticky bottom-0 flex gap-2 border-t border-rule bg-white p-4">
          {editing ? (
            <>
              <button
                onClick={() => setEditing(false)}
                className="min-h-11 rounded-md border border-rule-strong px-4 py-3 text-ink-muted"
              >
                ยกเลิก
              </button>
              <button
                onClick={save}
                disabled={busy}
                className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md bg-ink py-3 font-medium text-paper disabled:opacity-50"
              >
                {busyAction === "save" && (
                  <Loader2 size={16} strokeWidth={1.5} className="animate-spin" aria-hidden="true" />
                )}
                {busyAction === "save" ? "กำลังบันทึก" : "บันทึก"}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={remove}
                disabled={busy}
                className="flex min-h-11 items-center justify-center gap-2 rounded-md border border-rule-strong px-4 py-3 text-ink-muted disabled:opacity-50"
              >
                {busyAction === "delete" && (
                  <Loader2 size={16} strokeWidth={1.5} className="animate-spin" aria-hidden="true" />
                )}
                ลบ
              </button>
              <button
                onClick={() => setEditing(true)}
                className="min-h-11 flex-1 rounded-md border border-ink py-3 font-medium text-ink"
              >
                แก้ไข
              </button>
              {r.needs_review && (
                <button
                  onClick={confirm}
                  disabled={busy || incomplete}
                  className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md bg-ink py-3 font-medium text-paper disabled:opacity-50"
                >
                  {busyAction === "confirm" && (
                    <Loader2 size={16} strokeWidth={1.5} className="animate-spin" aria-hidden="true" />
                  )}
                  ยืนยัน
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}