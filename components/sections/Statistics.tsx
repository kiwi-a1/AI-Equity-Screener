"use client";
/** Statistics: the eight metric groups plus dividend and split history. */
import { useEffect } from "react";

import { fmtDate, fmtNumber, NA } from "@/lib/format";
import { groupRows, STAT_GROUP_NAMES } from "@/lib/statistics";
import type { History } from "@/lib/types";

import { DividendChart } from "../charts";
import { DataTable, Kicker, Ledger, Loading, Notice } from "../ui";
import { useApi } from "../useApi";
import type { SectionProps } from "./types";

export default function Statistics({ symbol, info, onContext }: SectionProps) {
  const hist = useApi<History>(`/api/history?symbol=${encodeURIComponent(symbol)}&range=MAX&interval=1mo`);

  useEffect(() => {
    if (!info) return;
    const visible: Record<string, Record<string, string>> = {};
    for (const g of STAT_GROUP_NAMES.slice(0, 5)) visible[g] = Object.fromEntries(groupRows(info, g).map((r) => [r.label, r.display]));
    onContext({}, visible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info]);

  if (!info) return <Notice>Statistics will appear as soon as the company profile loads.</Notice>;
  const derived = new Set(info.derived);
  const half = Math.ceil(STAT_GROUP_NAMES.length / 2);
  const divs = hist.data?.dividends ?? [];
  const byYear = Object.entries(
    divs.reduce<Record<string, number>>((acc, d) => {
      const y = d.date.slice(0, 4);
      acc[y] = (acc[y] ?? 0) + d.amount;
      return acc;
    }, {}),
  )
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-15)
    .map(([year, amount]) => ({ year, amount }));
  const splits = hist.data?.splits ?? [];

  return (
    <div>
      <p className="small muted" style={{ margin: "0 4px 12px" }}>
        Trading currency {info.currency ?? NA}
        {info.financialCurrency && info.financialCurrency !== info.currency ? `, financials reported in ${info.financialCurrency}` : ""}. ttm means
        trailing twelve months; mrq means most recent quarter. Values marked calc are calculated from reported statements and prices.
      </p>
      <div className="cols cols-2">
        {[STAT_GROUP_NAMES.slice(0, half), STAT_GROUP_NAMES.slice(half)].map((groups, i) => (
          <div key={i}>
            {groups.map((g) => {
              const rows = groupRows(info, g);
              const allMissing = rows.every((r) => r.display === NA);
              return (
                <section className="block plain" key={g}>
                  <Kicker>{g}</Kicker>
                  {allMissing ? (
                    <p className="small muted" style={{ marginTop: 0 }}>
                      None of these measures is reported for this {info.quoteType ? info.quoteType.toLowerCase() : "security"}.
                    </p>
                  ) : null}
                  <Ledger rows={rows.map((r) => ({ label: r.label, value: r.display, derived: derived.has(r.field) }))} />
                </section>
              );
            })}
          </div>
        ))}
      </div>
      <div className="cols cols-3-2">
        <section className="block">
          <Kicker aside="per share, by calendar year">Dividend History</Kicker>
          {byYear.length ? (
            <DividendChart byYear={byYear} />
          ) : hist.loading ? (
            <Loading lines={3} />
          ) : (
            <p className="muted">{info.name ?? symbol} has not paid a cash dividend in the available history. Returns come from price changes only.</p>
          )}
        </section>
        <section className="block">
          <Kicker>Stock Splits</Kicker>
          {splits.length ? (
            <DataTable
              rows={[...splits].reverse()}
              columns={[
                { key: "date", label: "Date", render: (r) => fmtDate(r.date) },
                { key: "ratio", label: "Ratio", render: (r) => r.ratio },
              ]}
            />
          ) : hist.loading ? (
            <Loading lines={2} />
          ) : (
            <p className="muted">No stock splits are recorded in the available price history{hist.data?.bars[0] ? `, which begins ${fmtDate(hist.data.bars[0].date)}` : ""}.</p>
          )}
          {divs.length ? (
            <p className="small muted">
              Most recent dividend {fmtNumber(divs[divs.length - 1].amount, 4)} on {fmtDate(divs[divs.length - 1].date)}.
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
