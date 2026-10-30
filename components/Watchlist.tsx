"use client";
/** Home-page watchlist: companies the visitor starred, with live prices. Kept in this browser. */
import { fmtNumber, fmtPct } from "@/lib/format";
import type { Quote } from "@/lib/types";

import { Updated } from "./live";
import { CountText } from "./motion";
import { useWatchlist } from "./saved";
import { changeClass, Kicker } from "./ui";
import { useApi } from "./useApi";

export default function Watchlist({ onSelect }: { onSelect: (s: string) => void }) {
  const { list, toggle } = useWatchlist();
  const res = useApi<Quote[]>(list.length ? `/api/quotes?symbols=${encodeURIComponent(list.join(","))}` : null, { refreshMs: 15_000 });
  const by = new Map((res.data ?? []).map((q) => [q.symbol, q]));
  return (
    <section className="block plain watchlist">
      <Kicker aside={list.length ? <Updated at={res.fetchedAt} /> : null}>Your Watchlist</Kicker>
      {!list.length ? (
        <p className="muted" style={{ marginTop: 0 }}>
          Star a company on its page to keep it here with live prices. Your watchlist is saved in this browser.
        </p>
      ) : (
        <div className="wl-grid">
          {list.map((s) => {
            const q = by.get(s);
            return (
              <div className="wl-tile" key={s}>
                <button type="button" className="wl-open" onClick={() => onSelect(s)}>
                  <span className="t-sym">{s}</span>
                  <span className="t-name">{q?.name ?? " "}</span>
                  {q ? (
                    <span className="wl-px">
                      <span className="num"><CountText id={`wl-${s}`} text={fmtNumber(q.price)} /></span>
                      <span className={`num ${changeClass(q.changePercent)}`}>{fmtPct(q.changePercent, { ratio: false, signed: true })}</span>
                    </span>
                  ) : (
                    <span className="sk sk-line" style={{ width: "70%" }} />
                  )}
                </button>
                <button type="button" className="wl-remove" onClick={() => toggle(s)} aria-label={`Remove ${s} from watchlist`} title="Remove">
                  Remove
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
