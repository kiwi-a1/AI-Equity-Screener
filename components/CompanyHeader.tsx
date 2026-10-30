"use client";
/**
 * Company name, identity and live price. The price ticks every 5 seconds while the page is open: each
 * change flashes green on an up-tick and red on a down-tick. A star adds the company to the watchlist.
 */
import { useEffect, useRef, useState } from "react";

import { fmtChange, fmtNumber, fmtPct } from "@/lib/format";
import type { CompanyInfo, Quote } from "@/lib/types";

import { Updated } from "./live";
import { CountText } from "./motion";
import { useWatchlist } from "./saved";
import { changeClass } from "./ui";
import { useApi } from "./useApi";

const STATES: Record<string, string> = {
  REGULAR: "market open", PRE: "pre-market", PREPRE: "pre-market", POST: "after hours", POSTPOST: "closed", CLOSED: "closed",
};

export default function CompanyHeader({ info }: { info: CompanyInfo }) {
  const live = useApi<Quote[]>(`/api/quotes?symbols=${encodeURIComponent(info.symbol)}`, { refreshMs: 5_000 });
  const q = live.data?.find((x) => x.symbol === info.symbol && typeof x.price === "number");
  const price = q?.price ?? info.price;
  const change = q?.change ?? info.change;
  const changePercent = q?.changePercent ?? info.changePercent;

  // Direction of the latest tick, so the flash shows whether the price just moved up or down.
  const last = useRef<number | null>(null);
  const [tick, setTick] = useState<{ n: number; dir: "up" | "down" | "flat" }>({ n: 0, dir: "flat" });
  useEffect(() => {
    if (price === null) return;
    const prev = last.current;
    last.current = price;
    if (prev !== null && prev !== price) setTick((t) => ({ n: t.n + 1, dir: price > prev ? "up" : "down" }));
  }, [price]);
  useEffect(() => {
    last.current = null;
  }, [info.symbol]);

  const { has, toggle } = useWatchlist();
  const starred = has(info.symbol);

  const state = STATES[((q?.marketState ?? info.marketState) ?? "").toUpperCase()];
  const ext = [
    info.preMarketPrice !== null ? { label: "Pre-market", price: info.preMarketPrice, pct: info.preMarketChangePercent } : null,
    info.postMarketPrice !== null ? { label: "After hours", price: info.postMarketPrice, pct: info.postMarketChangePercent } : null,
  ].filter(Boolean) as { label: string; price: number; pct: number | null }[];
  return (
    <header className="co-head">
      <div>
        <h2 className="co-name">
          {info.name ?? info.symbol}
          <button type="button" className={`star${starred ? " on" : ""}`} onClick={() => toggle(info.symbol)} aria-pressed={starred} aria-label={starred ? "Remove from watchlist" : "Add to watchlist"} title={starred ? "Remove from watchlist" : "Add to watchlist"}>
            <svg viewBox="0 0 24 24" aria-hidden><path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z" /></svg>
            <span>{starred ? "Watching" : "Watch"}</span>
          </button>
        </h2>
        <div className="co-meta">
          <strong>{info.symbol}</strong>
          {[info.exchange, info.currency, info.sector].filter(Boolean).map((x) => ` · ${x}`).join("")}
          {state ? <span className="state">{state}</span> : null}
        </div>
      </div>
      <div className="co-price">
        <span key={tick.n} className={`p num flash ${tick.n ? `${tick.dir}-flash` : ""}`}>
          <CountText id={`price-${info.symbol}`} text={fmtNumber(price)} />
        </span>
        <span className={`c num ${changeClass(change)}`}><CountText id={`chg-${info.symbol}`} text={fmtChange(change, changePercent)} /></span>
        <div className="co-live"><Updated at={live.fetchedAt ?? null} /></div>
        {ext.map((e) => (
          <div className="co-ext num" key={e.label}>
            {e.label} <strong>{fmtNumber(e.price)}</strong> <span className={changeClass(e.pct)}>{fmtPct(e.pct, { ratio: false, signed: true })}</span>
          </div>
        ))}
      </div>
    </header>
  );
}
