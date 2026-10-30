"use client";
/** Chart components (Recharts), styled to match the broadsheet theme. */
import { useMemo } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { fmtLarge, fmtNumber } from "@/lib/format";
import { movingAverage } from "@/lib/metrics";
import { useTheme, type Theme } from "./theme";
import type { PriceBar } from "@/lib/types";

/** Chart colours for each theme, drawn from the site palette. */
function palette(theme: Theme) {
  const dark = theme === "dark";
  const INK = dark ? "#fdebe0" : "#170a24";
  return {
    INK,
    ACCENT: dark ? "#e5677a" : "#c95a76",
    UP: dark ? "#4ade80" : "#15803d",
    DOWN: dark ? "#f87171" : "#b91c1c",
    RULE: dark ? "rgba(201,163,189,0.14)" : "rgba(58,29,82,0.12)",
    VOLUME: dark ? "rgba(229,103,122,0.25)" : "rgba(229,103,122,0.22)",
    MUTED: dark ? "#c9a3bd" : "#7a4a6e",
    SERIES: dark ? ["#e5677a", "#f8b27a", "#b24e78", "#ffd08c", "#833a7a", "#f28f79"] : ["#c95a76", "#5b2a7a", "#f28f79", "#9b4478", "#e5677a", "#833a7a"],
    FONT: { fontFamily: '"Times New Roman", Times, serif', fontSize: 13, fill: dark ? "#c9a3bd" : "#7a4a6e" },
    TOOLTIP: {
      contentStyle: {
        fontFamily: '"Times New Roman", Times, serif',
        background: dark ? "rgba(23,10,36,0.82)" : "rgba(255,255,255,0.82)",
        backdropFilter: "blur(14px)",
        border: dark ? "1px solid rgba(201,163,189,0.25)" : "1px solid rgba(58,29,82,0.15)",
        borderRadius: 12,
        color: INK,
      },
      labelStyle: { color: dark ? "#c9a3bd" : "#7a4a6e" },
      itemStyle: { color: INK },
      cursor: { fill: dark ? "rgba(255,255,255,0.05)" : "rgba(58,29,82,0.05)", stroke: dark ? "rgba(255,255,255,0.2)" : "rgba(58,29,82,0.2)" },
    },
  };
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
const fullDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function PriceChart({ bars, adjusted = false, showMA = true, height = 380 }: { bars: PriceBar[]; adjusted?: boolean; showMA?: boolean; height?: number }) {
  const { INK, ACCENT, UP, DOWN, RULE, VOLUME, MUTED, SERIES, FONT, TOOLTIP } = palette(useTheme());
  // Memoized so the line only redraws when the data changes, not on every page refresh.
  const { closes, data } = useMemo(() => {
    const closes = bars.map((b) => (adjusted ? b.adjClose ?? b.close : b.close));
    const ma50 = showMA ? movingAverage(closes, 50) : [];
    const ma200 = showMA ? movingAverage(closes, 200) : [];
    return { closes, data: bars.map((b, i) => ({ date: b.date, close: closes[i], volume: b.volume, ma50: ma50[i] ?? null, ma200: ma200[i] ?? null })) };
  }, [bars, adjusted, showMA]);
  const first = closes.find((v) => v !== null) ?? 0;
  const last = [...closes].reverse().find((v) => v !== null) ?? 0;
  const color = last >= first ? UP : DOWN;
  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={RULE} strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="date" tickFormatter={shortDate} tick={FONT} minTickGap={48} stroke={RULE} />
          <YAxis yAxisId="p" orientation="right" domain={["auto", "auto"]} tick={FONT} tickFormatter={(v) => fmtNumber(v)} stroke={RULE} width={70} />
          <YAxis yAxisId="v" hide domain={[0, (max: number) => max * 4]} />
          <Tooltip {...TOOLTIP} labelFormatter={(l) => fullDate(String(l))} formatter={(v, n) => [n === "Volume" ? fmtLarge(v) : fmtNumber(v), String(n)]} />
          <Bar yAxisId="v" dataKey="volume" name="Volume" fill={VOLUME} isAnimationActive={false} />
          <Line yAxisId="p" dataKey="close" name={adjusted ? "Adj Close" : "Close"} stroke={color} strokeWidth={1.8} dot={false} isAnimationActive animationDuration={1100} animationEasing="ease-out" />
          {showMA ? <Line yAxisId="p" dataKey="ma50" name="50-period average" stroke={MUTED} strokeWidth={1} dot={false} isAnimationActive animationDuration={1100} animationEasing="ease-out" /> : null}
          {showMA ? <Line yAxisId="p" dataKey="ma200" name="200-period average" stroke="#f8b27a" strokeWidth={1} strokeDasharray="4 3" dot={false} isAnimationActive animationDuration={1100} animationEasing="ease-out" /> : null}
          <Legend wrapperStyle={{ ...FONT, paddingTop: 6 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Sparkline({ bars, height = 200 }: { bars: PriceBar[]; height?: number }) {
  const { INK, ACCENT, UP, DOWN, RULE, VOLUME, MUTED, SERIES, FONT, TOOLTIP } = palette(useTheme());
  const data = useMemo(() => bars.map((b) => ({ date: b.date, close: b.close })), [bars]);
  const first = data.find((d) => d.close !== null)?.close ?? 0;
  const last = [...data].reverse().find((d) => d.close !== null)?.close ?? 0;
  const color = last >= first ? UP : DOWN;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="date" hide />
        <YAxis hide domain={["auto", "auto"]} />
        <Tooltip {...TOOLTIP} labelFormatter={(l) => fullDate(String(l))} formatter={(v) => [fmtNumber(v), "Close"]} />
        <Area dataKey="close" stroke={color} strokeWidth={1.8} fill="url(#spark)" isAnimationActive animationDuration={1100} animationEasing="ease-out" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function StatementChart({ periods, series, divisor, unit }: { periods: string[]; series: { label: string; values: (number | null)[] }[]; divisor: number; unit: string }) {
  const { INK, ACCENT, UP, DOWN, RULE, VOLUME, MUTED, SERIES, FONT, TOOLTIP } = palette(useTheme());
  const data = useMemo(() => {
    const order = periods.map((p, i) => ({ p, i })).reverse(); // oldest to newest, left to right
    return order.map(({ p, i }) => {
      const row: Record<string, string | number | null> = { period: p.slice(0, 10) };
      for (const s of series) row[s.label] = s.values[i] === null ? null : (s.values[i] as number) / divisor;
      return row;
    });
  }, [periods, series, divisor]);
  return (
    <ResponsiveContainer width="100%" height={340}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={RULE} strokeDasharray="2 4" vertical={false} />
        <XAxis dataKey="period" tick={FONT} stroke={RULE} />
        <YAxis tick={FONT} stroke={RULE} tickFormatter={(v) => fmtNumber(v, 0)} width={80} label={{ value: unit, angle: -90, position: "insideLeft", style: FONT }} />
        <Tooltip {...TOOLTIP} formatter={(v) => fmtNumber(v)} />
        <Legend wrapperStyle={{ ...FONT, paddingTop: 6 }} />
        {series.map((s, i) => (
          <Bar key={s.label} dataKey={s.label} fill={SERIES[i % SERIES.length]} radius={[5, 5, 0, 0]} isAnimationActive animationDuration={900} animationEasing="ease-out" />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ReturnsChart({ rows, symbol, benchmark }: { rows: { period: string; stock: number | null; benchmark: number | null }[]; symbol: string; benchmark: string }) {
  const { INK, ACCENT, UP, DOWN, RULE, VOLUME, MUTED, SERIES, FONT, TOOLTIP } = palette(useTheme());
  const data = useMemo(
    () => rows.map((r) => ({ period: r.period, [symbol]: r.stock === null ? null : r.stock * 100, [benchmark]: r.benchmark === null ? null : r.benchmark * 100 })),
    [rows, symbol, benchmark],
  );
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={RULE} strokeDasharray="2 4" vertical={false} />
        <XAxis dataKey="period" tick={FONT} stroke={RULE} />
        <YAxis tick={FONT} stroke={RULE} tickFormatter={(v) => `${v}%`} width={52} />
        <Tooltip {...TOOLTIP} formatter={(v) => `${Number(v).toFixed(2)}%`} />
        <Legend wrapperStyle={{ ...FONT }} />
        <Bar dataKey={symbol} fill={ACCENT} radius={[6, 6, 0, 0]} isAnimationActive animationDuration={900} animationEasing="ease-out" />
        <Bar dataKey={benchmark} fill={MUTED} fillOpacity={0.55} radius={[6, 6, 0, 0]} isAnimationActive animationDuration={900} animationEasing="ease-out" />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DividendChart({ byYear }: { byYear: { year: string; amount: number }[] }) {
  const { INK, ACCENT, UP, DOWN, RULE, VOLUME, MUTED, SERIES, FONT, TOOLTIP } = palette(useTheme());
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={byYear} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={RULE} strokeDasharray="2 4" vertical={false} />
        <XAxis dataKey="year" tick={FONT} stroke={RULE} />
        <YAxis tick={FONT} stroke={RULE} width={48} />
        <Tooltip {...TOOLTIP} formatter={(v) => [fmtNumber(v, 4), "Dividends per share"]} />
        <Bar dataKey="amount" fill={ACCENT} radius={[5, 5, 0, 0]} isAnimationActive animationDuration={900} animationEasing="ease-out" />
      </BarChart>
    </ResponsiveContainer>
  );
}
