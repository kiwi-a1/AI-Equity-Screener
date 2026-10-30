"use client";
/** Historical Data: range presets or custom dates, intervals within source limits, chart, table, CSV. */
import { useEffect, useMemo, useState } from "react";

import { fmtDate, fmtInt, fmtNumber, fmtPct } from "@/lib/format";
import { priceSummary } from "@/lib/metrics";
import type { History, PriceBar } from "@/lib/types";

import { PriceChart } from "../charts";
import { DataState, DataTable, Kicker, Ledger, Notice, Seg, StaleNote } from "../ui";
import { useApi } from "../useApi";
import type { SectionProps } from "./types";

const PRESETS = ["1M", "3M", "6M", "YTD", "1Y", "5Y", "MAX", "CUSTOM"] as const;
type Preset = (typeof PRESETS)[number];
const INTERVALS = [
  { value: "1d", label: "Daily" },
  { value: "1wk", label: "Weekly" },
  { value: "1mo", label: "Monthly" },
  { value: "60m", label: "Hourly" },
  { value: "15m", label: "15 minutes" },
  { value: "5m", label: "5 minutes" },
  { value: "1m", label: "1 minute" },
];
const INTRADAY = new Set(["60m", "15m", "5m", "1m"]);

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function HistoricalData({ symbol, info, onContext }: SectionProps) {
  const [preset, setPreset] = useState<Preset>("1Y");
  const [interval, setInterval] = useState("1d");
  const [start, setStart] = useState(iso(new Date(Date.now() - 365 * 86400e3)));
  const [end, setEnd] = useState(iso(new Date()));
  const [adjusted, setAdjusted] = useState(false);

  const range = preset === "CUSTOM" ? `start=${start}&end=${end}` : `range=${preset}`;
  const hist = useApi<History>(`/api/history?symbol=${encodeURIComponent(symbol)}&${range}&interval=${interval}`);
  const bars = hist.data?.bars ?? [];
  const note = hist.headers?.get("X-Range-Note") ?? null;
  const summary = useMemo(() => priceSummary(bars, interval === "1d"), [bars, interval]);
  const currency = hist.data?.currency ?? info?.currency ?? "";

  useEffect(() => {
    onContext(
      { range: preset === "CUSTOM" ? `${start} to ${end}` : preset, interval },
      { ...summary },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary, preset, interval]);

  const fmtRowDate = (b: PriceBar) => (INTRADAY.has(interval) ? fmtDate(b.date, true) : fmtDate(b.date));

  return (
    <div>
      <section className="block">
        <div className="controls">
          <Seg value={preset} onChange={setPreset} options={PRESETS.map((p) => ({ value: p, label: p === "MAX" ? "Max" : p === "CUSTOM" ? "Custom" : p }))} label="Range" />
          <span>
            <span className="ctl-label">Interval</span>
            <select value={interval} onChange={(e) => setInterval(e.target.value)} aria-label="Interval">
              {INTERVALS.map((i) => (
                <option key={i.value} value={i.value}>{i.label}</option>
              ))}
            </select>
          </span>
          <label className="check">
            <input type="checkbox" checked={adjusted} onChange={(e) => setAdjusted(e.target.checked)} /> Plot adjusted close
          </label>
        </div>
        {preset === "CUSTOM" ? (
          <div className="controls">
            <span><span className="ctl-label">From</span><input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} /></span>
            <span><span className="ctl-label">To</span><input type="date" value={end} min={start} max={iso(new Date())} onChange={(e) => setEnd(e.target.value)} /></span>
          </div>
        ) : null}
        {note ? <Notice kind="warn">{note}</Notice> : null}
        <StaleNote stale={hist.stale} error={hist.error} onRetry={hist.reload} />
        <DataState loading={hist.loading} error={hist.error} hasData={bars.length > 0} what="price history for this range" onRetry={hist.reload}>
          <div className="cols cols-3-2" style={{ alignItems: "start" }}>
            <PriceChart bars={bars} adjusted={adjusted} showMA={!INTRADAY.has(interval)} />
            <div>
              <Kicker>Period at a Glance</Kicker>
              <Ledger
                rows={[
                  { label: "Period return", value: fmtPct(summary.totalReturn, { signed: true }), className: (summary.totalReturn ?? 0) >= 0 ? "up" : "down" },
                  { label: "Period high", value: fmtNumber(summary.high) },
                  { label: "Period low", value: fmtNumber(summary.low) },
                  { label: "Annualized volatility", value: interval === "1d" ? fmtPct(summary.annualizedVolatility) : "Daily data only" },
                  { label: "Maximum drawdown", value: fmtPct(summary.maxDrawdown) },
                  { label: "Observations", value: fmtInt(summary.observations) },
                ]}
              />
              <p className="small muted">Return uses {summary.priceBasis === "Adj Close" ? "adjusted" : "unadjusted"} closes.</p>
            </div>
          </div>
        </DataState>
      </section>
      {bars.length ? (
        <section className="block">
          <Kicker aside={`${fmtDate(bars[0]?.date)} to ${fmtDate(bars[bars.length - 1]?.date)}${currency ? `, prices in ${currency}` : ""}`}>Price Table</Kicker>
          <p className="small muted">Close is the traded price. Adj Close is adjusted for splits and dividends. Open, high and low are unadjusted. Click a column to sort.</p>
          <DataTable
            rows={[...bars].reverse()}
            pageSize={50}
            csvName={`${symbol}_${interval}_${preset.toLowerCase()}.csv`}
            columns={[
              { key: "date", label: "Date", render: fmtRowDate, sortValue: (b) => b.date, csv: (b) => b.date },
              { key: "open", label: "Open", render: (b) => fmtNumber(b.open), sortValue: (b) => b.open, csv: (b) => b.open },
              { key: "high", label: "High", render: (b) => fmtNumber(b.high), sortValue: (b) => b.high, csv: (b) => b.high },
              { key: "low", label: "Low", render: (b) => fmtNumber(b.low), sortValue: (b) => b.low, csv: (b) => b.low },
              { key: "close", label: "Close", render: (b) => fmtNumber(b.close), sortValue: (b) => b.close, csv: (b) => b.close },
              { key: "adj", label: "Adj Close", render: (b) => fmtNumber(b.adjClose), sortValue: (b) => b.adjClose, csv: (b) => b.adjClose },
              { key: "vol", label: "Volume", render: (b) => fmtInt(b.volume), sortValue: (b) => b.volume, csv: (b) => b.volume },
            ]}
          />
        </section>
      ) : null}
    </div>
  );
}
