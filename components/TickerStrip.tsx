"use client";
/**
 * Featured companies, gliding slowly from left to right; clicking one opens its page. Hovering or touching
 * the band pauses it. Quotes refresh every 60 seconds.
 */
import { fmtNumber, fmtPct } from "@/lib/format";
import type { Quote } from "@/lib/types";

import { CountText, Marquee } from "./motion";
import { changeClass } from "./ui";
import { useApi } from "./useApi";

const SHORT_NAMES: Record<string, string> = {
  AAPL: "Apple", MSFT: "Microsoft", NVDA: "Nvidia", GOOGL: "Alphabet", AMZN: "Amazon", META: "Meta", TSLA: "Tesla", NFLX: "Netflix",
  AVGO: "Broadcom", AMD: "AMD", ORCL: "Oracle", CRM: "Salesforce", ADBE: "Adobe", INTC: "Intel", PLTR: "Palantir", UBER: "Uber",
  JPM: "JPMorgan Chase", V: "Visa", MA: "Mastercard", "BRK-B": "Berkshire Hathaway", WMT: "Walmart", COST: "Costco", KO: "Coca-Cola",
  DIS: "Disney", NKE: "Nike", LLY: "Eli Lilly", XOM: "Exxon Mobil", BA: "Boeing",
};
export const FEATURED = Object.keys(SHORT_NAMES);

export default function TickerStrip({ current, onSelect }: { current: string | null; onSelect: (s: string) => void }) {
  const { data, loading } = useApi<Quote[]>(`/api/quotes?symbols=${FEATURED.join(",")}`, { refreshMs: 60_000 });
  const bySymbol = new Map((data ?? []).map((q) => [q.symbol, q]));
  // Once quotes arrive, companies without a price are left out rather than shown as N/A.
  const shown = data && data.some((q) => q.price !== null) ? FEATURED.filter((s) => bySymbol.get(s)?.price != null) : FEATURED;
  return (
    <nav className="strip marquee-strip" aria-label="Featured companies">
      <Marquee direction="right" speed={34} label="Featured companies">
        {shown.map((s) => {
          const q = bySymbol.get(s);
          return (
            <button key={s} type="button" className={current === s ? "current" : ""} onClick={() => onSelect(s)}>
              <span className="t-sym">{s}</span>
              <span className="t-name">{SHORT_NAMES[s] ?? q?.name ?? ""}</span>
              {q ? (
                <>
                  <span className="t-price num"><CountText text={fmtNumber(q.price)} /></span>{" "}
                  <span className={`t-chg num ${changeClass(q.changePercent)}`}>{fmtPct(q.changePercent, { ratio: false, signed: true })}</span>
                </>
              ) : loading ? (
                <span className="sk sk-line" style={{ width: 90 }} />
              ) : (
                <span className="t-price num">N/A</span>
              )}
            </button>
          );
        })}
      </Marquee>
    </nav>
  );
}
