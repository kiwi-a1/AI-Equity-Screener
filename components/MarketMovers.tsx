"use client";
/** Today's biggest gainers, losers and most traded among large US companies, updating live. */
import { useState } from "react";

import { fmtLarge, fmtNumber, fmtPct } from "@/lib/format";
import type { Quote } from "@/lib/types";

import { Updated } from "./live";
import { CountText } from "./motion";
import { FEATURED } from "./TickerStrip";
import { changeClass, DataState, Kicker, Seg } from "./ui";
import { useApi } from "./useApi";

const UNIVERSE = [
  ...FEATURED,
  "UNH", "JNJ", "PG", "HD", "MRK", "ABBV", "PEP", "CVX", "BAC", "WFC", "CSCO", "QCOM", "TXN", "IBM", "MU", "PYPL",
  "SHOP", "SNOW", "COIN", "SBUX", "MCD", "T", "VZ", "PFE", "GS", "MS", "CAT", "GE", "F", "GM",
].filter((s, i, a) => a.indexOf(s) === i);

type View = "gainers" | "losers" | "active";

export default function MarketMovers({ onSelect }: { onSelect: (s: string) => void }) {
  const res = useApi<Quote[]>(`/api/quotes?symbols=${encodeURIComponent(UNIVERSE.join(","))}`, { refreshMs: 30_000 });
  const [view, setView] = useState<View>("gainers");
  const quotes = (res.data ?? []).filter((q) => typeof q.changePercent === "number" && typeof q.price === "number");
  const hasVolume = quotes.some((q) => typeof q.volume === "number");
  const rows =
    view === "gainers"
      ? [...quotes].sort((a, b) => (b.changePercent as number) - (a.changePercent as number))
      : view === "losers"
        ? [...quotes].sort((a, b) => (a.changePercent as number) - (b.changePercent as number))
        : [...quotes].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
  return (
    <section className="block movers">
      <Kicker aside={<Updated at={res.fetchedAt} />}>Market Movers</Kicker>
      <div className="controls">
        <Seg
          value={view}
          onChange={setView}
          options={[
            { value: "gainers", label: "Top gainers" },
            { value: "losers", label: "Top losers" },
            ...(hasVolume ? [{ value: "active" as View, label: "Most active" }] : []),
          ]}
        />
      </div>
      <DataState loading={res.loading} error={res.error} hasData={quotes.length > 0} what="market movers" onRetry={res.reload}>
        <ol className="mv-list">
          {rows.slice(0, 8).map((q, i) => (
            <li key={`${view}-${q.symbol}`} style={{ animationDelay: `${i * 40}ms` }}>
              <button type="button" onClick={() => onSelect(q.symbol)}>
                <span className="mv-rank num">{i + 1}</span>
                <span className="mv-id">
                  <strong>{q.symbol}</strong>
                  <span className="muted">{q.name ?? ""}</span>
                </span>
                <span className="mv-px num"><CountText text={fmtNumber(q.price)} /></span>
                {view === "active" ? (
                  <span className="mv-chg num muted">{fmtLarge(q.volume ?? null)}</span>
                ) : (
                  <span className={`mv-chg num ${changeClass(q.changePercent)}`}>{fmtPct(q.changePercent, { ratio: false, signed: true })}</span>
                )}
              </button>
            </li>
          ))}
        </ol>
        <p className="small muted" style={{ margin: "8px 0 0" }}>Among {quotes.length} large US companies. Refreshes every 30 seconds.</p>
      </DataState>
    </section>
  );
}
