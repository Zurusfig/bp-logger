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
    <nav className="no-print flex gap-5 border-b border-rule px-4 text-[15px]">
      {LINKS.map((l) => {
        const active = pathname === l.href;
        return (
          <Link
            key={l.href}
            href={l.href}
            className={
              "flex min-h-11 items-center border-b-2 transition-colors duration-150 " +
              (active
                ? "border-ink font-medium text-ink"
                : "border-transparent text-ink-muted")
            }
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
