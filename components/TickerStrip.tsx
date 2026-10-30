"use client";
/** Live quote band for featured companies; clicking one opens its page. Refreshes every 60 seconds. */
import { fmtNumber, fmtPct } from "@/lib/format";
import type { Quote } from "@/lib/types";

import { changeClass } from "./ui";
import { useApi } from "./useApi";

export const FEATURED = ["AAPL", "MSFT", "TSLA", "NVDA", "AMZN", "GOOGL", "META", "NFLX"];

const SHORT_NAMES: Record<string, string> = {
  AAPL: "Apple", MSFT: "Microsoft", TSLA: "Tesla", NVDA: "Nvidia", AMZN: "Amazon", GOOGL: "Alphabet", META: "Meta", NFLX: "Netflix",
};

export default function TickerStrip({ current, onSelect }: { current: string | null; onSelect: (s: string) => void }) {
  const { data, loading } = useApi<Quote[]>(`/api/quotes?symbols=${FEATURED.join(",")}`, { refreshMs: 60_000 });
  const bySymbol = new Map((data ?? []).map((q) => [q.symbol, q]));
  return (
    <nav className="strip" aria-label="Featured companies">
      {FEATURED.map((s) => {
        const q = bySymbol.get(s);
        return (
          <button key={s} type="button" className={current === s ? "current" : ""} onClick={() => onSelect(s)}>
            <span className="t-sym">{s}</span>
            <span className="t-name">{SHORT_NAMES[s] ?? q?.name ?? ""}</span>
            <span className="t-price num">{q ? fmtNumber(q.price) : loading ? "\u00a0" : "N/A"}</span>{" "}
            <span className={`t-chg num ${changeClass(q?.changePercent)}`}>{q ? fmtPct(q.changePercent, { ratio: false, signed: true }) : ""}</span>
          </button>
        );
      })}
    </nav>
  );
}
