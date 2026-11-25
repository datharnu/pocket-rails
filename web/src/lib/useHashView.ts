"use client";

import { useCallback, useEffect, useState } from "react";

/** A dashboard section kept in the URL hash (#money, #rules…), so a section can be linked to and survives a reload. */
export function useHashView<K extends string>(views: readonly K[], fallback: K): [K, (k: K) => void] {
  const [view, setView] = useState<K>(fallback);
  useEffect(() => {
    const read = () => {
      const h = window.location.hash.slice(1) as K;
      setView(views.includes(h) ? h : fallback);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const set = useCallback((k: K) => {
    setView(k);
    history.replaceState(null, "", k === fallback ? window.location.pathname + window.location.search : `#${k}`);
  }, [fallback]);
  return [view, set];
}
