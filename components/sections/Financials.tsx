"use client";
/** Financials: three statements, annual or quarterly, with units, period count, chart and computed ratios. */
import { useEffect, useMemo, useState } from "react";

import { STATEMENT_LABELS } from "@/lib/data/statements";
import { fmtNumber, fmtPct, NA } from "@/lib/format";
import { statementGrowth, statementRatios } from "@/lib/metrics";
import type { Frequency, Statement, StatementKind, StatementLine } from "@/lib/types";

import { StatementChart } from "../charts";
import { DataState, DataTable, Kicker, Notice, Seg, StaleNote } from "../ui";
import { useApi } from "../useApi";
import type { SectionProps } from "./types";

const UNITS = { Raw: 1, Thousands: 1e3, Millions: 1e6, Billions: 1e9 } as const;
type Unit = keyof typeof UNITS;

const DEFAULT_CHART: Record<StatementKind, string[]> = {
  income: ["totalRevenue", "grossProfit", "operatingIncome", "netIncome"],
  balance: ["totalAssets", "totalLiabilitiesNetMinorityInterest", "stockholdersEquity", "totalDebt"],
  cashflow: ["operatingCashFlow", "capitalExpenditure", "freeCashFlow"],
};

const periodLabel = (p: string, f: Frequency) => `${f === "annual" ? "FY" : "Qtr"} ${p.slice(0, 10)}`;

export default function Financials({ symbol, info, onContext }: SectionProps) {
  const [kind, setKind] = useState<StatementKind>("income");
  const [freq, setFreq] = useState<Frequency>("annual");
  const [unit, setUnit] = useState<Unit>("Millions");
  const [showAll, setShowAll] = useState(false);
  const [oldestFirst, setOldestFirst] = useState(false);
  const [count, setCount] = useState(0); // 0 = all periods
  const [chartKeys, setChartKeys] = useState<string[] | null>(null);

  const primary = useApi<Statement>(`/api/financials?symbol=${encodeURIComponent(symbol)}&statement=${kind}&frequency=${freq}`);
  // Fallback: if the chosen frequency has nothing reported, load the other one so the section is never empty.
  const otherFreq: Frequency = freq === "annual" ? "quarterly" : "annual";
  const primaryEmpty = !primary.loading && !(primary.data && primary.data.lines.length);
  const alt = useApi<Statement>(primaryEmpty ? `/api/financials?symbol=${encodeURIComponent(symbol)}&statement=${kind}&frequency=${otherFreq}` : null);
  const usingAlt = primaryEmpty && !!alt.data && alt.data.lines.length > 0;
  const stmt = usingAlt ? alt : primary;
  const shownFreq: Frequency = usingAlt ? otherFreq : freq;
  const balance = useApi<Statement>(kind === "income" ? `/api/financials?symbol=${encodeURIComponent(symbol)}&statement=balance&frequency=${shownFreq}` : null);
  const s = stmt.data && stmt.data.lines.length ? stmt.data : null;
  const currency = info?.financialCurrency ?? info?.currency ?? "";
  const divisor = UNITS[unit];

  useEffect(() => {
    setChartKeys(null);
    setCount(0);
  }, [kind, freq]);

  const n = s?.periods.length ?? 0;
  const shown = count > 0 ? Math.min(count, n) : n;
  const idx = useMemo(() => {
    const base = Array.from({ length: shown }, (_, i) => i);
    return oldestFirst ? base.reverse() : base;
  }, [shown, oldestFirst]);
  const lines: StatementLine[] = s ? (showAll ? s.lines : s.lines.filter((l) => l.isKey)) : [];
  const selected = chartKeys ?? (s ? DEFAULT_CHART[kind].filter((k) => s.lines.some((l) => l.key === k)) : []);

  const cell = (l: StatementLine, v: number | null) => (v === null ? NA : l.kind === "perShare" ? fmtNumber(v) : fmtNumber(v / divisor, divisor >= 1e9 ? 2 : 0));

  useEffect(() => {
    if (!s) return;
    const latest: Record<string, number | null> = {};
    for (const l of s.lines.filter((x) => x.isKey).slice(0, 15)) latest[l.label] = l.values[0] ?? null;
    onContext({ statement: STATEMENT_LABELS[kind], frequency: shownFreq, units: unit, periods_shown: shown }, { latest_period: s.periods[0]?.slice(0, 10), ...latest });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, kind, shownFreq, unit, shown]);

  const ratios = s && kind === "income" ? statementRatios(s, balance.data) : [];
  const growth = s && kind === "income"
    ? ([["totalRevenue", "Revenue Growth"], ["netIncome", "Net Income Growth"], ["dilutedEPS", "Diluted EPS Growth"]] as const)
        .map(([k, label]) => ({ label: `${label} (${shownFreq === "annual" ? "year over year" : "quarter over quarter"})`, kind: "pct" as const, values: statementGrowth(s, k) }))
        .filter((r) => r.values.length)
    : [];
  const derived = [...ratios, ...growth];

  const loading = primary.loading || (primaryEmpty && alt.loading);
  const error = primary.error && !s ? primary.error : null;
  const periodCols = <R,>(render: (row: R, i: number) => string) =>
    idx.map((i) => ({ key: s!.periods[i], label: periodLabel(s!.periods[i], shownFreq), render: (r: R) => render(r, i) }));

  return (
    <div>
      <section className="block">
        <div className="controls">
          <Seg value={kind} onChange={setKind} options={(Object.keys(STATEMENT_LABELS) as StatementKind[]).map((k) => ({ value: k, label: STATEMENT_LABELS[k] }))} />
          <Seg value={freq} onChange={setFreq} options={[{ value: "annual", label: "Annual" }, { value: "quarterly", label: "Quarterly" }]} />
          <span>
            <span className="ctl-label">Units</span>
            <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)} aria-label="Units">
              {Object.keys(UNITS).map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          </span>
          {n > 1 ? (
            <span>
              <span className="ctl-label">Periods</span>
              <select value={count} onChange={(e) => setCount(Number(e.target.value))} aria-label="Periods shown">
                <option value={0}>All ({n})</option>
                {Array.from({ length: n - 1 }, (_, i) => i + 1).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </span>
          ) : null}
          <label className="check"><input type="checkbox" checked={oldestFirst} onChange={(e) => setOldestFirst(e.target.checked)} /> Oldest first</label>
          <label className="check"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> All line items</label>
        </div>
        {usingAlt ? (
          <Notice>
            No {freq} {STATEMENT_LABELS[kind].toLowerCase()} is reported for this company, so the {otherFreq} figures are shown.
          </Notice>
        ) : null}
        <StaleNote stale={stmt.stale} error={stmt.error} onRetry={stmt.reload} />
        <DataState loading={loading} error={error} hasData={!!s} what={`${STATEMENT_LABELS[kind].toLowerCase()} data`} onRetry={primary.reload}>
          {s ? (
            <>
              <p className="small muted">
                Values in {currency} {divisor > 1 ? unit.toLowerCase() : ""}; EPS in {currency} per share; share counts use the same scale. N/A means not reported for that period.
              </p>
              <DataTable
                rows={lines.length ? lines : s.lines}
                rowClass={(l) => (l.isKey ? "key" : "")}
                csvName={`${symbol}_${kind}_${shownFreq}.csv`}
                columns={[
                  { key: "item", label: "Line item", render: (l) => l.label, csv: (l) => l.label },
                  ...idx.map((i) => ({
                    key: s.periods[i],
                    label: periodLabel(s.periods[i], shownFreq),
                    render: (l: StatementLine) => cell(l, l.values[i] ?? null),
                    csv: (l: StatementLine) => l.values[i] ?? null,
                  })),
                ]}
              />
            </>
          ) : null}
        </DataState>
      </section>
      {s ? (
        <section className="block">
          <Kicker aside="follows the statement, frequency and periods above">Chart</Kicker>
          <div className="controls">
            <select
              multiple
              value={selected.length ? selected : s.lines.slice(0, 3).map((l) => l.key)}
              onChange={(e) => setChartKeys(Array.from(e.target.selectedOptions).map((o) => o.value))}
              aria-label="Metrics to chart"
              style={{ minWidth: 320, height: 110 }}
            >
              {s.lines.map((l) => (
                <option key={l.key} value={l.key}>{l.label}</option>
              ))}
            </select>
            <span className="small muted">Hold Cmd or Ctrl to pick several metrics.</span>
          </div>
          {(() => {
            const keys = selected.length ? selected : s.lines.slice(0, 3).map((l) => l.key);
            const order = idx.map((i) => s.periods[i]).sort().reverse();
            return (
              <StatementChart
                periods={order}
                series={keys.map((k) => {
                  const l = s.lines.find((x) => x.key === k)!;
                  return { label: l.label, values: order.map((p) => l.values[s.periods.indexOf(p)] ?? null) };
                })}
                divisor={keys.every((k) => s.lines.find((x) => x.key === k)?.kind === "perShare") ? 1 : divisor}
                unit={`${currency}${divisor > 1 ? ` ${unit.toLowerCase()}` : ""}`}
              />
            );
          })()}
        </section>
      ) : null}
      {s && derived.length ? (
        <section className="block">
          <Kicker aside="computed from the reported statements">Margins, Returns and Growth</Kicker>
          <DataTable
            rows={derived}
            columns={[
              { key: "m", label: "Metric", render: (r) => r.label },
              ...periodCols<(typeof derived)[number]>((r, i) => (r.kind === "pct" ? fmtPct(r.values[i] ?? null) : fmtNumber(r.values[i] ?? null))),
            ]}
          />
          <p className="small muted">Return on equity and assets use period-end balances and appear only where a balance sheet exists for the same date.</p>
        </section>
      ) : null}
    </div>
  );
}
