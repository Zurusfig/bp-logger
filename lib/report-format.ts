/**
 * Shared formatting for the printable/exportable report views (ReportSheet,
 * ReportTable). Colours are hex, not Tailwind classes: these views are
 * rasterised to PNG via html2canvas-pro, which cannot parse the oklch()
 * values Tailwind v4 emits. The hex values mirror the app's ink/paper/rule
 * tokens in app/globals.css so the printed sheet and the on-screen app read
 * as the same document.
 */

export const INK = "#211f1c";
export const INK_MUTED = "#6b655d";
export const INK_FAINT = "#938c7e";
export const RULE = "#cabfae";
export const HEADER_TINT = "#f4f1ea";

const TH_MONTHS = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

export function thaiDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${TH_MONTHS[m - 1]}`;
}

export function thaiFull(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${TH_MONTHS[m - 1]} ${y + 543}`;
}

export const bkkTime = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
