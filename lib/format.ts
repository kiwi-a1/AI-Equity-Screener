/** Display formatting shared by UI and AI context. Missing values render as NA, never as 0. */
import type { Num } from "./types";

export const NA = "N/A";

export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function toNum(v: unknown): Num {
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
  if (typeof v === "object" && v !== null && "raw" in v) return toNum((v as { raw: unknown }).raw);
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function fmtLarge(v: unknown, decimals = 2): string {
  const n = toNum(v);
  if (n === null) return NA;
  const a = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  for (const [t, s] of [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]] as const) {
    if (a >= t) return `${sign}${(a / t).toFixed(decimals)}${s}`;
  }
  return `${sign}${a.toFixed(decimals)}`;
}

export function fmtNumber(v: unknown, decimals = 2): string {
  const n = toNum(v);
  if (n === null) return NA;
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function fmtInt(v: unknown): string {
  const n = toNum(v);
  return n === null ? NA : Math.round(n).toLocaleString("en-US");
}

/** ratio=true: 0.123 -> 12.30% ; ratio=false: value is already a percent. */
export function fmtPct(v: unknown, { ratio = true, signed = false, decimals = 2 } = {}): string {
  const n = toNum(v);
  if (n === null) return NA;
  const p = ratio ? n * 100 : n;
  const s = p.toFixed(decimals);
  return `${signed && p > 0 ? "+" : ""}${s}%`;
}

export function fmtChange(change: unknown, pct: unknown): string {
  const c = toNum(change);
  const p = toNum(pct);
  if (c === null && p === null) return NA;
  const parts: string[] = [];
  if (c !== null) parts.push(`${c > 0 ? "+" : ""}${fmtNumber(c)}`);
  if (p !== null) parts.push(`(${p > 0 ? "+" : ""}${p.toFixed(2)}%)`);
  return parts.join(" ");
}

export function fmtDate(v: unknown, withTime = false): string {
  if (v === null || v === undefined || v === "") return NA;
  const d = v instanceof Date ? v : new Date(typeof v === "number" && v < 1e11 ? v * 1000 : (v as string | number));
  if (Number.isNaN(d.getTime())) return NA;
  const opts: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" };
  if (withTime) Object.assign(opts, { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleString("en-US", opts);
}

export function timeAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return fmtDate(iso);
}

export type ValueKind = "large" | "price" | "pct" | "pctPoints" | "ratio" | "int" | "date" | "text";

export function fmtValue(v: unknown, kind: ValueKind): string {
  switch (kind) {
    case "large": return fmtLarge(v);
    case "price": return fmtNumber(v);
    case "pct": return fmtPct(v);
    case "pctPoints": return fmtPct(v, { ratio: false });
    case "ratio": return fmtNumber(v);
    case "int": return fmtInt(v);
    case "date": return fmtDate(v);
    default: return v === null || v === undefined || v === "" ? NA : String(v);
  }
}

/** Only allow http(s) links from third-party content. */
export function safeUrl(u: unknown): string | null {
  return typeof u === "string" && /^https?:\/\//i.test(u.trim()) ? u.trim() : null;
}

export function toCsv(rows: (string | number | null)[][]): string {
  return rows
    .map((r) => r.map((c) => (c === null ? "" : /[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c))).join(","))
    .join("\n");
}
