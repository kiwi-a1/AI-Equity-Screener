"use client";
/** Company name, identity and live price. The price refreshes every 30 seconds while the page is open. */
import { fmtChange, fmtNumber, fmtPct } from "@/lib/format";
import type { CompanyInfo } from "@/lib/types";

import { changeClass } from "./ui";

const STATES: Record<string, string> = {
  REGULAR: "market open", PRE: "pre-market", PREPRE: "pre-market", POST: "after hours", POSTPOST: "closed", CLOSED: "closed",
};

export default function CompanyHeader({ info }: { info: CompanyInfo }) {
  const state = STATES[(info.marketState ?? "").toUpperCase()];
  const ext = [
    info.preMarketPrice !== null ? { label: "Pre-market", price: info.preMarketPrice, pct: info.preMarketChangePercent } : null,
    info.postMarketPrice !== null ? { label: "After hours", price: info.postMarketPrice, pct: info.postMarketChangePercent } : null,
  ].filter(Boolean) as { label: string; price: number; pct: number | null }[];
  return (
    <header className="co-head">
      <div>
        <h2 className="co-name">{info.name ?? info.symbol}</h2>
        <div className="co-meta">
          <strong>{info.symbol}</strong>
          {[info.exchange, info.currency, info.sector].filter(Boolean).map((x) => ` · ${x}`).join("")}
          {state ? <span className="state">{state}</span> : null}
        </div>
      </div>
      <div className="co-price">
        <span className="p num">{fmtNumber(info.price)}</span>
        <span className={`c num ${changeClass(info.change)}`}>{fmtChange(info.change, info.changePercent)}</span>
        {ext.map((e) => (
          <div className="co-ext num" key={e.label}>
            {e.label} <strong>{fmtNumber(e.price)}</strong> <span className={changeClass(e.pct)}>{fmtPct(e.pct, { ratio: false, signed: true })}</span>
          </div>
        ))}
      </div>
    </header>
  );
}
