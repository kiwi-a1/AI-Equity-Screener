"use client";
/** Thin market tape across the top of every page: indices, rates, commodities, currencies and crypto, scrolling right to left. */
import { fmtNumber, fmtPct } from "@/lib/format";
import type { Quote } from "@/lib/types";

import { Marquee } from "./motion";
import { changeClass } from "./ui";
import { useApi } from "./useApi";

const TAPE: { symbol: string; name: string }[] = [
  { symbol: "^GSPC", name: "S&P 500" },
  { symbol: "^IXIC", name: "Nasdaq" },
  { symbol: "^DJI", name: "Dow Jones" },
  { symbol: "^RUT", name: "Russell 2000" },
  { symbol: "^VIX", name: "VIX" },
  { symbol: "^TNX", name: "US 10Y Yield" },
  { symbol: "^FTSE", name: "FTSE 100" },
  { symbol: "^GDAXI", name: "DAX" },
  { symbol: "^N225", name: "Nikkei 225" },
  { symbol: "^NSEI", name: "Nifty 50" },
  { symbol: "GC=F", name: "Gold" },
  { symbol: "SI=F", name: "Silver" },
  { symbol: "CL=F", name: "Crude Oil" },
  { symbol: "EURUSD=X", name: "EUR/USD" },
  { symbol: "BTC-USD", name: "Bitcoin" },
  { symbol: "ETH-USD", name: "Ether" },
];

export default function TickerTape() {
  const { data, loading } = useApi<Quote[]>(`/api/quotes?symbols=${encodeURIComponent(TAPE.map((t) => t.symbol).join(","))}`, { refreshMs: 60_000 });
  const by = new Map((data ?? []).map((q) => [q.symbol, q]));
  const items = TAPE.filter((t) => typeof by.get(t.symbol)?.price === "number");

  if (!items.length) {
    // Shimmering placeholder while loading; the band hides itself if no quotes are available.
    return loading ? <div className="tape tape-loading" aria-hidden><span className="sk sk-line" /></div> : null;
  }
  return (
    <Marquee className="tape" direction="left" speed={48} label="Market ticker">
      {items.map((t) => {
        const q = by.get(t.symbol)!;
        const cls = changeClass(q.changePercent);
        return (
          <span className="tape-item" key={t.symbol}>
            <span className="n">{t.name}</span>
            <span className="p num">{fmtNumber(q.price)}</span>
            <span className={`c num ${cls}`}><i className={`tri ${cls}`} aria-hidden />{fmtPct(q.changePercent, { ratio: false, signed: true })}</span>
          </span>
        );
      })}
    </Marquee>
  );
}
