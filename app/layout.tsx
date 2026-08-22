import type { Metadata } from "next";
import { Anuphan } from "next/font/google";
import "./globals.css";

// Anuphan: a Thai/Latin variable family designed as one unit (Cadson Demak), so
// the SYS/DIA Latin labels sit on the same optical grid as the Thai body text
// instead of falling back to a mismatched system font.
const anuphan = Anuphan({
  variable: "--font-anuphan",
  subsets: ["thai", "latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "บันทึกความดันโลหิต",
  description: "บันทึกและติดตามความดันโลหิตประจำวัน สรุปเป็นรายงานสำหรับหมอ",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="th" className={`${anuphan.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
