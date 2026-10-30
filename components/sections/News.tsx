"use client";
/** News: merged article feed with cover images, performance against the benchmark, AI summary. */
import { useEffect, useState } from "react";

import { fmtDate, fmtPct, timeAgo } from "@/lib/format";
import type { NewsItem, PerformanceRow } from "@/lib/types";

import { ReturnsChart } from "../charts";
import { changeClass, DataState, Kicker, Notice, StaleNote } from "../ui";
import { useApi } from "../useApi";
import type { SectionProps } from "./types";

export function Cover({ item }: { item: NewsItem }) {
  const [broken, setBroken] = useState(false);
  if (item.source === "resource") return <div className="news-cover ph resource" aria-hidden>SOURCE</div>;
  if (!item.image || broken) {
    return <div className="news-cover ph" aria-hidden>{(item.publisher ?? item.title).charAt(0).toUpperCase()}</div>;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="news-cover" src={item.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
}

export function Article({ item }: { item: NewsItem }) {
  return (
    <li className="news-item">
      <a href={item.url} target="_blank" rel="noopener noreferrer" tabIndex={-1} style={{ textDecoration: "none" }}>
        <Cover item={item} />
      </a>
      <div>
        <a className="news-title" href={item.url} target="_blank" rel="noopener noreferrer">
          {item.title}
        </a>
        <div className="news-meta">
          {item.source === "resource" ? `Reference link, ${item.publisher}` : item.publisher ?? "Unknown publisher"}
          {item.published ? <span title={fmtDate(item.published, true)}>, {timeAgo(item.published)}</span> : null}
        </div>
        {item.summary ? <p className="news-sum">{item.summary.length > 260 ? `${item.summary.slice(0, 260)}...` : item.summary}</p> : null}
      </div>
    </li>
  );
}

export default function News({ symbol, info, onContext, ask }: SectionProps) {
  const name = info?.name ?? "";
  const news = useApi<NewsItem[]>(`/api/news?symbol=${encodeURIComponent(symbol)}&name=${encodeURIComponent(name)}`);
  const perf = useApi<{ benchmark: string; rows: PerformanceRow[] }>(`/api/performance?symbol=${encodeURIComponent(symbol)}`);
  const items = news.data ?? [];
  const onlyResources = items.length > 0 && items.every((i) => i.source === "resource");
  // Feature the top story large only when it has a cover image.
  const lead = items[0]?.image ? items[0] : null;
  const rest = lead ? items.slice(1) : items;

  useEffect(() => {
    onContext(
      {},
      {
        headlines: items.slice(0, 10).map((i) => ({ title: i.title, publisher: i.publisher, date: i.published?.slice(0, 10), url: i.url })),
        returns: perf.data?.rows,
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [news.data, perf.data]);

  return (
    <div className="cols cols-3-2">
      <section className="block plain">
        <Kicker
          aside={
            <button className="btn ghost" type="button" disabled={!items.length || onlyResources} onClick={() => ask(`Summarize the latest ${symbol} news. Identify catalysts and risks, and cite each article with its link and date.`)}>
              Summarize with AI
            </button>
          }
        >
          Latest Coverage
        </Kicker>
        {onlyResources ? (
          <Notice>No recent articles were found for this company, so here are the best places to follow its announcements, filings and coverage.</Notice>
        ) : null}
        <StaleNote stale={news.stale} error={news.error} onRetry={news.reload} />
        <DataState loading={news.loading} error={news.error} hasData={items.length > 0} what="news" onRetry={news.reload}>
          {lead ? <ul className="news-list news-lead"><Article item={lead} /></ul> : null}
          <ul className="news-list">
            {rest.map((i) => (
              <Article key={i.id} item={i} />
            ))}
          </ul>
        </DataState>
      </section>
      <aside className="block" style={{ alignSelf: "start" }}>
        <Kicker aside={perf.data ? `against ${perf.data.benchmark === "^GSPC" ? "the S&P 500" : perf.data.benchmark}` : null}>Performance</Kicker>
        <DataState loading={perf.loading} error={perf.error} hasData={!!perf.data} what="performance data" onRetry={perf.reload}>
          {perf.data ? (
            <>
              <ReturnsChart rows={perf.data.rows.slice(0, 3)} symbol={symbol} benchmark={perf.data.benchmark === "^GSPC" ? "S&P 500" : perf.data.benchmark} />
              <ul className="ledger" style={{ marginTop: 12 }}>
                {perf.data.rows.map((r) => (
                  <li key={r.period}>
                    <span className="l">{r.period}</span>
                    <span className="dots" />
                    <span className={`v num ${changeClass(r.stock)}`}>{fmtPct(r.stock, { signed: true })}</span>
                    <span className="v num muted" style={{ fontWeight: 400, minWidth: 80, textAlign: "right" }}>
                      {fmtPct(r.benchmark, { signed: true })}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="small muted">Total returns including dividends, company first and index second. N/A means the price history does not cover the full period.</p>
            </>
          ) : null}
        </DataState>
      </aside>
    </div>
  );
}
