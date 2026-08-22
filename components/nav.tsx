"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/app", label: "รายการ" },
  { href: "/app/report", label: "สรุปสำหรับหมอ" },
] as const;

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="no-print flex gap-4 border-b border-stone-300 bg-stone-50 px-4 py-2 text-sm">
      {LINKS.map((l) => {
        const active = pathname === l.href;
        return (
          <Link
            key={l.href}
            href={l.href}
            className={
              active
                ? "font-medium text-stone-900 underline underline-offset-4"
                : "text-stone-500"
            }
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
