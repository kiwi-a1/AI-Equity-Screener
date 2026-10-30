"use client";
/**
 * Landing-page market news: general finance headlines from several publishers (separate from the
 * company News section). Every headline opens the original article on the publisher's site.
 */
import { useMemo, useState } from "react";

import type { NewsItem } from "@/lib/types";

import { Article } from "./sections/News";
import { DataState, Kicker, Notice, Seg } from "./ui";
import { useApi } from "./useApi";

const PAGE = 12;

export default function MarketNews() {
  const res = useApi<NewsItem[]>("/api/market-news", { refreshMs: 10 * 60_000 });
  const [publisher, setPublisher] = useState("All");
  const [shown, setShown] = useState(PAGE);
  const items = useMemo(() => res.data ?? [], [res.data]);
  const onlyResources = items.length > 0 && items.every((i) => i.source === "resource");

  const publishers = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of items) if (i.publisher && i.source !== "resource") counts.set(i.publisher, (counts.get(i.publisher) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([p]) => p);
  }, [items]);

  const filtered = publisher === "All" ? items : items.filter((i) => i.publisher === publisher);
  const lead = filtered.find((i) => i.image) ?? null;
  const rest = filtered.filter((i) => i !== lead).slice(0, shown);
  const half = Math.ceil(rest.length / 2);

  return (
    <section className="block plain">
      <Kicker aside={publishers.length ? `from ${publishers.length} publishers, refreshed every 10 minutes` : null}>Market News</Kicker>
      {publishers.length > 1 ? (
        <div className="controls">
          <Seg value={publisher} onChange={(p) => { setPublisher(p); setShown(PAGE); }} options={["All", ...publishers].map((p) => ({ value: p, label: p }))} />
        </div>
      ) : null}
      {onlyResources ? <Notice>Headlines could not be loaded right now. These publishers carry live market coverage:</Notice> : null}
      <DataState loading={res.loading} error={res.error} hasData={items.length > 0} what="market news" onRetry={res.reload}>
        {lead ? (
          <ul className="news-list news-lead">
            <Article item={lead} />
          </ul>
        ) : null}
        <div className="cols cols-2" style={{ gap: 28 }}>
          {[rest.slice(0, half), rest.slice(half)].map((col, i) => (
            <ul className="news-list" key={i}>
              {col.map((n) => (
                <Article key={n.id} item={n} />
              ))}
            </ul>
          ))}
        </div>
        {filtered.length - (lead ? 1 : 0) > shown ? (
          <div style={{ textAlign: "center", marginTop: 12 }}>
            <button className="btn ghost" type="button" onClick={() => setShown((s) => s + PAGE)}>Show more headlines</button>
          </div>
        ) : null}
      </DataState>
    </section>
  );
}
