"use client";
/** Home-page market snapshot: major indices with today's move and a one-year S&P 500 chart. */
import { fmtNumber, fmtPct } from "@/lib/format";
import type { History, Quote } from "@/lib/types";

import { Sparkline } from "./charts";
import { Updated } from "./live";
import { CountText } from "./motion";
import { changeClass, DataState, Kicker } from "./ui";
import { useApi } from "./useApi";

export const INDICES: { symbol: string; name: string }[] = [
  { symbol: "^GSPC", name: "S&P 500" },
  { symbol: "^IXIC", name: "Nasdaq Composite" },
  { symbol: "^DJI", name: "Dow Jones Industrial" },
  { symbol: "^RUT", name: "Russell 2000" },
  { symbol: "^VIX", name: "Volatility Index" },
];

export default function MarketOverview() {
  const quotes = useApi<Quote[]>(`/api/quotes?symbols=${encodeURIComponent(INDICES.map((i) => i.symbol).join(","))}`, { refreshMs: 15_000 });
  const spx = useApi<History>(`/api/history?symbol=${encodeURIComponent("^GSPC")}&range=1Y&interval=1d`);
  const by = new Map((quotes.data ?? []).map((q) => [q.symbol, q]));
  const bars = spx.data?.bars ?? [];
  const first = bars.find((b) => b.close !== null)?.close ?? null;
  const last = [...bars].reverse().find((b) => b.close !== null)?.close ?? null;
  const yr = first && last ? (last - first) / first : null;

  return (
    <div className="cols cols-2-3">
      <section className="block plain">
        <Kicker aside={<Updated at={quotes.fetchedAt} />}>Markets Today</Kicker>
        <DataState loading={quotes.loading} error={quotes.error} hasData={(quotes.data ?? []).length > 0} what="index quotes" onRetry={quotes.reload}>
          <ul className="ledger">
            {INDICES.map((i) => {
              const q = by.get(i.symbol);
              return (
                <li key={i.symbol}>
                  <span className="l">{i.name}</span>
                  <span className="dots" />
                  <span className="v num"><CountText text={fmtNumber(q?.price ?? null)} /></span>
                  <span className={`v num ${changeClass(q?.changePercent)}`} style={{ minWidth: 76, textAlign: "right" }}>
                    <CountText text={fmtPct(q?.changePercent ?? null, { ratio: false, signed: true })} />
                  </span>
                </li>
              );
            })}
          </ul>
        </DataState>
      </section>
      <section className="block">
        <Kicker aside={yr !== null ? <span className={yr >= 0 ? "up" : "down"}>{fmtPct(yr, { signed: true })} over one year</span> : null}>S&amp;P 500</Kicker>
        <DataState loading={spx.loading} error={spx.error} hasData={bars.length > 0} what="index history" onRetry={spx.reload}>
          <Sparkline bars={bars} height={210} />
        </DataState>
      </section>
    </div>
  );
}
