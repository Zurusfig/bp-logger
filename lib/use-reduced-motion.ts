"use client";

import { useEffect, useState } from "react";

/**
 * The global CSS rule in app/globals.css collapses transition/animation
 * *durations*, which does nothing for recharts — it animates via JS, not
 * CSS. Chart components read this to skip their animation outright.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
