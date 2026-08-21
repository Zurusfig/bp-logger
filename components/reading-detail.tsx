"use client";

import { useEffect, useState } from "react";
import { apiFetch, type LiffSession } from "@/lib/liff";
import type { ReadingDto } from "@/app/api/readings/route";

type Detail = ReadingDto & {
  image_url: string | null;
  ocr_raw: { observations?: string } | null;
  edited_by: string | null;
  reviewed_by: string | null;
};

const SLOT_LABEL: Record<string, string> = { morning: "เช้า", evening: "ก่อนนอน" };

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
    <label className="flex-1 border-r border-stone-200 px-3 py-2 last:border-r-0">
      <span className="block text-xs text-stone-500">{label}</span>
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
  onClose,
  onChanged,
}: {
  reading: ReadingDto;
  session: LiffSession;
  members: Record<string, string>;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sys, setSys] = useState(reading.sys?.toString() ?? "");
  const [dia, setDia] = useState(reading.dia?.toString() ?? "");
  const [pulse, setPulse] = useState(reading.pulse?.toString() ?? "");
  const [takenAt, setTakenAt] = useState(toLocalInput(reading.taken_at));

  useEffect(() => {
    apiFetch<Detail>(`/api/readings/${reading.id}`, session)
      .then(setDetail)
      .catch((e) => setError(String(e.message ?? e)));
  }, [reading.id, session]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const r = detail ?? reading;
  const incomplete = !sys || !dia || !pulse;

  async function save() {
    setBusy(true);
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
      onClose();
    } catch (e: any) {
      setError(String(e.message ?? e));
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    try {
      await apiFetch(`/api/readings/${reading.id}/review`, session, { method: "POST" });
      onChanged();
      onClose();
    } catch (e: any) {
      setError(String(e.message ?? e));
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("ลบรายการนี้")) return;
    setBusy(true);
    try {
      await apiFetch(`/api/readings/${reading.id}`, session, { method: "DELETE" });
      onChanged();
      onClose();
    } catch (e: any) {
      setError(String(e.message ?? e));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/40" onClick={onClose}>
      <div
        className="mx-auto mt-auto max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-xl bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-stone-200 bg-white px-4 py-3">
          <div>
            <div className="font-medium">
              {bkk(r.taken_at, { day: "numeric", month: "short" })}{" "}
              {SLOT_LABEL[r.slot ?? ""] ?? ""}{" "}
              {bkk(r.taken_at, { hour: "2-digit", minute: "2-digit", hour12: false })}
            </div>
            <div className="text-xs text-stone-500">
              บันทึกโดย {members[r.sender_id] || "ไม่ทราบ"}
              {detail?.edited_by ? ` แก้ไขโดย ${members[detail.edited_by] || "ไม่ทราบ"}` : ""}
            </div>
          </div>
          <button onClick={onClose} className="px-2 py-1 text-stone-500" aria-label="ปิด">
            ✕
          </button>
        </div>

        <div className="flex border-b border-stone-200">
          {editing ? (
            <>
              <NumberField label="SYS" value={sys} onChange={setSys} />
              <NumberField label="DIA" value={dia} onChange={setDia} />
              <NumberField label="ชีพจร" value={pulse} onChange={setPulse} />
            </>
          ) : (
            <>
              {(["sys", "dia", "pulse"] as const).map((f) => (
                <div
                  key={f}
                  className="flex-1 border-r border-stone-200 px-3 py-2 last:border-r-0"
                >
                  <div className="text-xs text-stone-500">
                    {f === "pulse" ? "ชีพจร" : f.toUpperCase()}
                  </div>
                  <div className="text-2xl font-semibold tabular-nums">
                    {r[f] ?? <span className="text-stone-300">—</span>}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        {editing && (
          <label className="block border-b border-stone-200 px-4 py-3">
            <span className="block text-xs text-stone-500">เวลาที่วัด</span>
            <input
              type="datetime-local"
              value={takenAt}
              onChange={(e) => setTakenAt(e.target.value)}
              className="w-full bg-transparent py-1 text-base outline-none"
            />
          </label>
        )}

        {r.needs_review && !editing && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
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

        <div className="bg-stone-100 p-4">
          {detail?.image_url ? (
            <img
              src={detail.image_url}
              alt="รูปหน้าจอเครื่องวัด"
              className="mx-auto max-h-[46vh] w-auto rounded"
            />
          ) : detail ? (
            <p className="py-8 text-center text-sm text-stone-500">ไม่มีรูป</p>
          ) : (
            <p className="py-8 text-center text-sm text-stone-500">กำลังโหลดรูป</p>
          )}
        </div>

        {detail?.ocr_raw?.observations && !editing && (
          <details className="border-t border-stone-200 px-4 py-3 text-sm text-stone-600">
            <summary className="cursor-pointer text-stone-500">รายละเอียดการอ่าน</summary>
            <p className="mt-2">{detail.ocr_raw.observations}</p>
          </details>
        )}

        {error && <p className="px-4 py-3 text-sm text-red-700">{error}</p>}

        <div className="sticky bottom-0 flex gap-2 border-t border-stone-200 bg-white p-4">
          {editing ? (
            <>
              <button
                onClick={() => setEditing(false)}
                className="rounded-md border border-stone-300 px-4 py-3 text-stone-700"
              >
                ยกเลิก
              </button>
              <button
                onClick={save}
                disabled={busy}
                className="flex-1 rounded-md bg-stone-900 py-3 font-medium text-white disabled:bg-stone-300"
              >
                {busy ? "กำลังบันทึก" : "บันทึก"}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={remove}
                disabled={busy}
                className="rounded-md border border-stone-300 px-4 py-3 text-stone-600"
              >
                ลบ
              </button>
              <button
                onClick={() => setEditing(true)}
                className="flex-1 rounded-md border border-stone-900 py-3 font-medium text-stone-900"
              >
                แก้ไข
              </button>
              {r.needs_review && (
                <button
                  onClick={confirm}
                  disabled={busy || incomplete}
                  className="flex-1 rounded-md bg-stone-900 py-3 font-medium text-white disabled:bg-stone-300"
                >
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