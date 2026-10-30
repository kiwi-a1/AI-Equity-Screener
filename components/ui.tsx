"use client";
/** Presentational building blocks shared by every section. */
import { useMemo, useState, type ReactNode } from "react";

import { NA, toCsv } from "@/lib/format";

import { CountText } from "./motion";

export function Kicker({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <h3 className="kicker">
      <span>{children}</span>
      {aside ? <span className="aside">{aside}</span> : null}
    </h3>
  );
}

export const CALC_TITLE = "Calculated from the company's reported statements and prices because it was not reported directly";

export function CalcMark() {
  return <sup className="calc" title={CALC_TITLE}>calc</sup>;
}

export function Ledger({ rows, twoColumn = false }: { rows: { label: string; value: string; className?: string; derived?: boolean }[]; twoColumn?: boolean }) {
  return (
    <ul className={`ledger${twoColumn ? " two" : ""}`}>
      {rows.map((r) => (
        <li key={r.label}>
          <span className="l">{r.label}</span>
          <span className="dots" />
          <span className={`v ${r.value === NA ? "na" : ""} ${r.className ?? ""}`} title={r.value === NA ? "Not available for this company" : undefined}>
            <CountText text={r.value} />
            {r.derived && r.value !== NA ? <CalcMark /> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Official reference links; used wherever a feed has no rows so a section is never blank. */
export function ResourceList({ items }: { items: { label: string; url: string; description: string }[] }) {
  return (
    <ul className="resources">
      {items.map((r) => (
        <li key={r.url}>
          <a href={r.url} target="_blank" rel="noopener noreferrer">
            <div className="r-title">{r.label}</div>
            <div className="r-desc">{r.description}</div>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label?: string }) {
  return (
    <span className="seg-wrap">
      {label ? <span className="ctl-label">{label}</span> : null}
      <span className="seg" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} type="button" className={o.value === value ? "on" : ""} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </span>
    </span>
  );
}

export function Notice({ kind = "info", children, onRetry }: { kind?: "info" | "warn" | "error"; children: ReactNode; onRetry?: () => void }) {
  return (
    <div className={`notice ${kind === "info" ? "" : kind}`} role={kind === "error" ? "alert" : "status"}>
      {children}
      {onRetry ? (
        <button className="btn ghost" type="button" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

/** Placeholder while data loads: a heading, a chart-sized block and a few lines, with a light sweeping across. */
export function Loading({ lines = 4 }: { lines?: number }) {
  return (
    <div className="loading-card" aria-busy="true" aria-label="Loading">
      {lines >= 4 ? (
        <>
          <div className="shimmer sk-title" />
          <div className="shimmer sk-chart" />
        </>
      ) : null}
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="shimmer sk-line" style={{ width: `${92 - i * 11}%` }} />
      ))}
    </div>
  );
}

/** Standard state handling for one API result: loading, error with retry, empty, or content. */
export function DataState({
  loading, error, hasData, what, onRetry, children,
}: { loading: boolean; error: string | null; hasData: boolean; what: string; onRetry: () => void; children: ReactNode }) {
  if (loading && !hasData) return <Loading />;
  if (!hasData && error) return <Notice kind="error" onRetry={onRetry}>Could not load {what} right now. {error}</Notice>;
  if (!hasData) return <Notice>No {what} is available for this company.</Notice>;
  return <>{children}</>;
}

export function StaleNote({ stale, error, onRetry }: { stale: boolean; error: string | null; onRetry: () => void }) {
  if (!stale) return null;
  return (
    <Notice kind="warn" onRetry={onRetry}>
      Showing the last data that loaded successfully; the latest refresh failed{error ? ` (${error})` : ""}.
    </Notice>
  );
}

export interface Column<R> {
  key: string;
  label: string;
  render: (row: R) => ReactNode;
  sortValue?: (row: R) => number | string | null;
  csv?: (row: R) => string | number | null;
  className?: (row: R) => string;
}

/** Sortable, paginated table with optional CSV export. */
export function DataTable<R>({
  rows, columns, pageSize = 0, csvName, rowClass, initialSort,
}: { rows: R[]; columns: Column<R>[]; pageSize?: number; csvName?: string; rowClass?: (r: R) => string; initialSort?: { key: string; dir: 1 | -1 } }) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(initialSort ?? null);
  const [page, setPage] = useState(0);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    return [...rows].sort((a, b) => {
      const x = col.sortValue!(a);
      const y = col.sortValue!(b);
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [rows, columns, sort]);
  const pages = pageSize ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  const current = Math.min(page, pages - 1);
  const visible = pageSize ? sorted.slice(current * pageSize, current * pageSize + pageSize) : sorted;

  const download = () => {
    const header = columns.map((c) => c.label);
    const body = sorted.map((r) => columns.map((c) => (c.csv ? c.csv(r) : null)));
    const blob = new Blob([toCsv([header, ...body])], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = csvName ?? "data.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={c.sortValue ? "sortable" : ""}
                  onClick={c.sortValue ? () => setSort((s) => ({ key: c.key, dir: s?.key === c.key ? ((-s.dir) as 1 | -1) : -1 })) : undefined}
                  aria-sort={sort?.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
                >
                  {c.label}
                  {sort?.key === c.key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => (
              <tr key={i} className={rowClass ? rowClass(r) : ""}>
                {columns.map((c) => {
                  const content = c.render(r);
                  return (
                    <td key={c.key} className={`${content === NA ? "na" : ""} ${c.className ? c.className(r) : ""}`}>
                      {content}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pageSize || csvName ? (
        <div className="pager">
          <span>
            {sorted.length.toLocaleString("en-US")} rows{pageSize && pages > 1 ? `, page ${current + 1} of ${pages}` : ""}
          </span>
          <span style={{ display: "flex", gap: 8 }}>
            {pageSize && pages > 1 ? (
              <>
                <button className="btn ghost" type="button" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</button>
                <button className="btn ghost" type="button" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Next</button>
              </>
            ) : null}
            {csvName ? <button className="btn ghost" type="button" onClick={download}>Download CSV</button> : null}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function RangeBar({ low, high, value, format }: { low: number | null; high: number | null; value: number | null; format: (v: number | null) => string }) {
  if (low === null || high === null || high <= low) return null;
  const pos = value === null ? null : Math.min(100, Math.max(0, ((value - low) / (high - low)) * 100));
  return (
    <div className="range" aria-label="52-week range">
      <div className="track">
        {pos !== null ? <div className="fill" style={{ left: 0, width: `${pos}%` }} /> : null}
        {pos !== null ? <div className="mark" style={{ left: `calc(${pos}% - 1px)` }} /> : null}
      </div>
      <div className="ends num">
        <span>{format(low)}</span>
        <span>52-week range</span>
        <span>{format(high)}</span>
      </div>
    </div>
  );
}

export function changeClass(v: number | null | undefined): string {
  if (v === null || v === undefined || v === 0) return "flat";
  return v > 0 ? "up" : "down";
}
