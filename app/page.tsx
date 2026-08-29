import Link from "next/link";

/**
 * Root landing page. The product itself lives under /app and is a LIFF app — it
 * needs a LINE ID token, so opening it outside LINE will not get past initLiff().
 * This page exists so the deployment root is not a dead end for anyone who
 * arrives here directly.
 */
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center gap-6 bg-paper px-6 text-ink">
      <div>
        <h1 className="text-2xl font-semibold">บันทึกความดันโลหิต</h1>
        <p className="mt-1 text-[15px] text-ink-muted">Blood pressure logger</p>
      </div>

      <p className="text-[15px] leading-relaxed text-ink-muted">
        อ่านค่าความดันจากรูปถ่ายที่ส่งในแชทกลุ่ม แล้วสรุปเป็นตารางสำหรับพบหมอ
      </p>

      <Link
        href="/app"
        className="flex min-h-11 w-fit items-center rounded-md border border-ink bg-ink px-4 text-[15px] text-paper"
      >
        เปิดรายการบันทึก
      </Link>

      <p className="text-[13px] text-ink-faint">
        เปิดจากแอป LINE เพื่อเข้าสู่ระบบ
      </p>
    </main>
  );
}
