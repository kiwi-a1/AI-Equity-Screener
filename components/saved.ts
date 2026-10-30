"use client";
/** Per-browser lists (watchlist, recently viewed) kept in localStorage and shared live between components and tabs. */
import { useCallback, useEffect, useState } from "react";

const EVENT = "equity-screener-saved";

function read(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function write(key: string, list: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* storage unavailable: lasts for this visit */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: key }));
}

export function useSavedList(key: string) {
  const [list, setList] = useState<string[]>([]);
  useEffect(() => {
    setList(read(key));
    const sync = (e: Event) => {
      if (e instanceof StorageEvent ? e.key === key : (e as CustomEvent).detail === key) setList(read(key));
    };
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [key]);
  const update = useCallback((fn: (l: string[]) => string[]) => write(key, fn(read(key))), [key]);
  return [list, update] as const;
}

export const WATCHLIST = "equity-screener-watchlist";
export const RECENT = "equity-screener-recent";

export function useWatchlist() {
  const [list, update] = useSavedList(WATCHLIST);
  const toggle = useCallback((s: string) => update((l) => (l.includes(s) ? l.filter((x) => x !== s) : [s, ...l].slice(0, 30))), [update]);
  return { list, toggle, has: (s: string) => list.includes(s) };
}

export function useRecent() {
  const [list, update] = useSavedList(RECENT);
  const add = useCallback((s: string) => update((l) => [s, ...l.filter((x) => x !== s)].slice(0, 8)), [update]);
  const clear = useCallback(() => update(() => []), [update]);
  return { list, add, clear };
}
