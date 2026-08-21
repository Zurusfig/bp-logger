"use client";

import { useEffect, useState } from "react";
import { apiFetch, type LiffSession } from "@/lib/liff";
import type { ReadingDto } from "@/app/api/readings/route";

type Detail = ReadingDto & {
  image_url: string | null;
  ocr_raw: { observations?: string; orientation_deg?: number } | null;
  posted_at: string;
  edited_by: string | null;
  reviewed_by: string | null;
};

const SLOT_LABEL: Record<string, string> = { morning: "เช้า", evening: "ก่อนนอน" };

function Field({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex-1 border-r border-stone-200 px-3 py-2 last:border-r-0">
      <div className="text-xs text-stone-500">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">
        {value ?? <span className="text-stone-300">—</span>}
      </div>
    </div>
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Detail>(`/api/readings/${reading.id}`, session)
      .then(setDetail)
      .catch((e) => setError(String(e.message ?? e)));
  }, [reading.id, session]);

  // Escape closes; body scroll locked while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

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

  const r = detail ?? reading;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/40" onClick={onClose}>
      <div
        className="mt-auto max-h-[92vh] overflow-y-auto rounded-t-xl bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-stone-200 bg-white px-4 py-3">
          <div>
            <div className="font-medium">
              {new Date(r.taken_at).toLocaleDateString("th-TH", {
                timeZone: "Asia/Bangkok",
                day: "numeric",
                month: "short",
              })}{" "}
              · {SLOT_LABEL[r.slot ?? ""] ?? ""}{" "}
              {new Intl.DateTimeFormat("en-GB", {
                timeZone: "Asia/Bangkok",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              }).format(new Date(r.taken_at))}
            </div>
            <div className="text-xs text-stone-500">
              บันทึกโดย {members[r.sender_id] || "—"}
            </div>
          </div>
          <button onClick={onClose} className="px-2 py-1 text-stone-500" aria-label="ปิด">
            ✕
          </button>
        </div>

        <div className="flex border-b border-stone-200">
          <Field label="SYS" value={r.sys} />
          <Field label="DIA" value={r.dia} />
          <Field label="ชีพจร" value={r.pulse} />
        </div>

        {r.needs_review && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div className="font-medium">รอตรวจสอบ</div>
            <div className="mt-1 text-amber-800">
              {r.review_note ||
                (r.confidence !== null
                  ? `เครื่องอ่านได้ไม่ชัด (${Math.round(r.confidence * 100)}%)`
                  : "ต้องยืนยันตัวเลข")}
            </div>
            <div className="mt-1">เทียบกับรูปด้านล่าง ถ้าตรงให้กดยืนยัน</div>
          </div>
        )}

        <div className="bg-stone-100 p-4">
          {detail?.image_url ? (
            <img
              src={detail.image_url}
              alt="รูปหน้าจอเครื่องวัด"
              className="mx-auto max-h-[52vh] w-auto rounded"
            />
          ) : detail ? (
            <p className="py-8 text-center text-sm text-stone-500">ไม่มีรูป</p>
          ) : (
            <p className="py-8 text-center text-sm text-stone-500">กำลังโหลดรูป…</p>
          )}
        </div>

        {detail?.ocr_raw?.observations && (
          <details className="border-t border-stone-200 px-4 py-3 text-sm text-stone-600">
            <summary className="cursor-pointer text-stone-500">รายละเอียดการอ่าน</summary>
            <p className="mt-2">{detail.ocr_raw.observations}</p>
          </details>
        )}

        {error && <p className="px-4 py-3 text-sm text-red-700">{error}</p>}

        {r.needs_review && (
          <div className="sticky bottom-0 border-t border-stone-200 bg-white p-4">
            <button
              onClick={confirm}
              disabled={busy || r.sys === null || r.dia === null || r.pulse === null}
              className="w-full rounded-md bg-stone-900 py-3 font-medium text-white disabled:bg-stone-300"
            >
              {busy ? "กำลังบันทึก…" : "ยืนยันว่าถูกต้อง"}
            </button>
            {(r.sys === null || r.dia === null || r.pulse === null) && (
              <p className="mt-2 text-center text-xs text-stone-500">
                ยังมีช่องที่อ่านไม่ออก — แก้ไขได้ในขั้นตอนถัดไป
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}