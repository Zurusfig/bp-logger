"use client";

import { useEffect, useState } from "react";

/**
 * Debounces a loading flag so a fast response never flashes a skeleton.
 * Returns true only once `active` has stayed true for `delayMs`.
 */
export function useDelayedFlag(active: boolean, delayMs = 200): boolean {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => setShow(true), delayMs);
    return () => {
      clearTimeout(t);
      setShow(false);
    };
  }, [active, delayMs]);

  return show;
}
