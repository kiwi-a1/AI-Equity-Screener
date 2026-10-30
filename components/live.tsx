"use client";
/** Live-feel pieces: the US market clock, "updated 5s ago" freshness, and the shared clock tick they use. */
import { useEffect, useState } from "react";

import { marketClock } from "@/lib/market";

/** Re-renders every `ms` so relative times stay current. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function MarketClockBadge() {
  const now = useNow(15_000);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []); // render on the client only, so server and browser times never disagree
  if (!ready) return <span className="mclock placeholder" aria-hidden />;
  const c = marketClock(new Date(now));
  return (
    <span className={`mclock ${c.open ? "open" : "closed"}`} title="US stock market, regular hours (New York time)">
      <i className="pulse" aria-hidden />
      <strong>US market {c.open ? "open" : "closed"}</strong>
      <span className="sep" aria-hidden>·</span>
      <span>{c.label}</span>
    </span>
  );
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

/** "Live · updated 5s ago", counting up each second and resetting with every refresh. */
export function Updated({ at, live = true }: { at: string | null; live?: boolean }) {
  const now = useNow(1000);
  if (!at) return null;
  const age = now - new Date(at).getTime();
  return (
    <span className={`updated${live && age < 90_000 ? " live" : ""}`} key={at}>
      {live ? <i className="pulse" aria-hidden /> : null}
      Updated {ago(age)}
    </span>
  );
}
