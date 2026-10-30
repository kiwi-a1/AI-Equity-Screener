"use client";
/**
 * Holders: ownership breakdown, top institutional and mutual-fund holders, insiders. Every report date is
 * shown. Where a feed has no rows, official filing links take its place so no part of the page is empty.
 */
import { useEffect, useState } from "react";

import { fmtDate, fmtInt, fmtLarge, fmtPct } from "@/lib/format";
import type { Holder, Holders as HoldersData, ResourceLink } from "@/lib/types";

import { changeClass, DataState, DataTable, Kicker, Ledger, ResourceList, Seg, StaleNote } from "../ui";
import { useApi } from "../useApi";
import type { SectionProps } from "./types";

function HolderTable({ rows, label, file, resources }: { rows: Holder[]; label: string; file: string; resources: ResourceLink[] }) {
  if (!rows.length) {
    return (
      <>
        <p className="muted" style={{ marginTop: 0 }}>
          No {label.toLowerCase()} positions are published in the data feed for this company. The full filings are available from the official sources below.
        </p>
        <ResourceList items={resources} />
      </>
    );
  }
  const dates = rows.map((r) => r.dateReported).filter(Boolean).sort() as string[];
  return (
    <>
      {dates.length ? (
        <p className="small muted" style={{ marginTop: 0 }}>
          Reported {fmtDate(dates[0])}
          {dates[dates.length - 1] !== dates[0] ? ` to ${fmtDate(dates[dates.length - 1])}` : ""}
        </p>
      ) : null}
      <DataTable
        rows={rows}
        csvName={file}
        initialSort={{ key: "shares", dir: -1 }}
        columns={[
          { key: "holder", label, render: (r) => r.holder, sortValue: (r) => r.holder, csv: (r) => r.holder },
          { key: "shares", label: "Shares", render: (r) => fmtInt(r.shares), sortValue: (r) => r.shares, csv: (r) => r.shares },
          { key: "date", label: "Date Reported", render: (r) => fmtDate(r.dateReported), sortValue: (r) => r.dateReported, csv: (r) => r.dateReported?.slice(0, 10) ?? null },
          { key: "pct", label: "% Out", render: (r) => fmtPct(r.pctHeld), sortValue: (r) => r.pctHeld, csv: (r) => r.pctHeld },
          { key: "value", label: "Value", render: (r) => fmtLarge(r.value), sortValue: (r) => r.value, csv: (r) => r.value },
          { key: "chg", label: "% Change", render: (r) => fmtPct(r.pctChange, { signed: true }), sortValue: (r) => r.pctChange, csv: (r) => r.pctChange, className: (r) => changeClass(r.pctChange) },
        ]}
      />
    </>
  );
}

export default function Holders({ symbol, info, onContext }: SectionProps) {
  const res = useApi<HoldersData>(`/api/holders?symbol=${encodeURIComponent(symbol)}`);
  const [tab, setTab] = useState<"institutional" | "funds" | "insiders">("institutional");
  const d = res.data;

  useEffect(() => {
    if (!d) return;
    onContext({ table: tab }, {
      major_holders: d.major,
      top_institutions: d.institutional.slice(0, 5).map((h) => ({ holder: h.holder, pct_out: h.pctHeld, date: h.dateReported?.slice(0, 10) })),
      insiders: d.insiders.slice(0, 5).map((h) => ({ name: h.name, relation: h.relation, shares: h.shares })),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, tab]);

  const majorKnown = !!d && Object.values(d.major).some((v) => v !== null);
  const insidersPct = d?.major.insidersPercentHeld ?? null;
  const instPct = d?.major.institutionsPercentHeld ?? null;
  const other = insidersPct !== null && instPct !== null ? Math.max(0, 1 - insidersPct - instPct) : null;

  return (
    <div>
      <StaleNote stale={res.stale} error={res.error} onRetry={res.reload} />
      <DataState loading={res.loading} error={res.error} hasData={!!d} what="ownership data" onRetry={res.reload}>
        {d ? (
          <>
            <div className="cols cols-2-3">
              <section className="block plain">
                <Kicker aside={d.majorFromStatistics ? "from key statistics" : null}>Ownership Breakdown</Kicker>
                {majorKnown ? (
                  <>
                    <Ledger
                      rows={[
                        { label: "Held by insiders", value: fmtPct(insidersPct) },
                        { label: "Held by institutions", value: fmtPct(instPct) },
                        { label: "Float held by institutions", value: fmtPct(d.major.institutionsFloatPercentHeld) },
                        { label: "Institutions holding shares", value: fmtInt(d.major.institutionsCount) },
                        { label: "Other holders and public", value: fmtPct(other) },
                      ]}
                    />
                    {other !== null ? (
                      <div className="range" aria-label="Ownership split">
                        <div className="track" style={{ display: "flex", overflow: "hidden" }}>
                          <div style={{ width: `${(insidersPct ?? 0) * 100}%`, background: "#c9a3bd" }} />
                          <div style={{ width: `${(instPct ?? 0) * 100}%`, background: "linear-gradient(90deg, #e5677a, #f8b27a)" }} />
                        </div>
                        <div className="ends"><span>Insiders</span><span>Institutions</span><span>Other</span></div>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <>
                    <p className="muted" style={{ marginTop: 0 }}>The ownership breakdown is not published in the data feed for {info?.name ?? symbol}. Official filings:</p>
                    <ResourceList items={d.resources} />
                  </>
                )}
              </section>
              <section className="block plain">
                <Kicker aside="filings are periodic, not real-time">About These Records</Kicker>
                <p className="lede" style={{ marginTop: 0 }}>
                  Institutional and fund positions come from periodic regulatory filings, such as quarterly 13F reports in the United States. Each row is
                  as of its report date, so recent trades may not appear yet.
                </p>
                <ResourceList items={d.resources.slice(0, 2)} />
              </section>
            </div>
            <section className="block" style={{ marginTop: 16 }}>
              <div className="controls">
                <Seg
                  value={tab}
                  onChange={setTab}
                  options={[
                    { value: "institutional", label: `Top Institutions (${d.institutional.length})` },
                    { value: "funds", label: `Top Mutual Funds (${d.funds.length})` },
                    { value: "insiders", label: `Insiders (${d.insiders.length})` },
                  ]}
                />
              </div>
              {tab === "institutional" ? (
                <HolderTable rows={d.institutional} label="Institution" file={`${symbol}_institutional_holders.csv`} resources={d.resources} />
              ) : tab === "funds" ? (
                <HolderTable rows={d.funds} label="Fund" file={`${symbol}_fund_holders.csv`} resources={d.resources} />
              ) : d.insiders.length ? (
                <DataTable
                  rows={d.insiders}
                  csvName={`${symbol}_insiders.csv`}
                  initialSort={{ key: "shares", dir: -1 }}
                  columns={[
                    { key: "name", label: "Insider", render: (r) => r.name, sortValue: (r) => r.name, csv: (r) => r.name },
                    { key: "rel", label: "Role", render: (r) => r.relation ?? "Not stated", csv: (r) => r.relation },
                    { key: "shares", label: "Shares Held Directly", render: (r) => fmtInt(r.shares), sortValue: (r) => r.shares, csv: (r) => r.shares },
                    { key: "tx", label: "Latest Transaction", render: (r) => r.latestTransaction ?? "Not stated", csv: (r) => r.latestTransaction },
                    { key: "date", label: "Date", render: (r) => fmtDate(r.date), sortValue: (r) => r.date, csv: (r) => r.date?.slice(0, 10) ?? null },
                  ]}
                />
              ) : (
                <>
                  <p className="muted" style={{ marginTop: 0 }}>No insider roster is published in the data feed for this company. Insider filings are available here:</p>
                  <ResourceList items={d.resources} />
                </>
              )}
            </section>
          </>
        ) : null}
      </DataState>
    </div>
  );
}
