"use client";
/**
 * Small motion helpers: a seamless scrolling band (Marquee) and numbers that count to their value
 * (CountText). Both stand still for people whose device asks for reduced motion.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Endless horizontal band. The content is rendered twice side by side and the track slides by exactly
 * one copy, so the loop has no visible seam. Speed is in pixels per second, so it feels the same
 * whatever the content width. Pauses while hovered, focused or touched.
 */
export function Marquee({ children, direction = "left", speed = 40, className = "", label }: { children: ReactNode; direction?: "left" | "right"; speed?: number; className?: string; label?: string }) {
  const group = useRef<HTMLDivElement>(null);
  const [duration, setDuration] = useState<number | null>(null);
  useEffect(() => {
    const el = group.current;
    if (!el) return;
    const measure = () => setDuration(Math.max(12, Math.round(el.scrollWidth / speed)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [speed]);
  return (
    <div className={`marquee ${className}`} role="region" aria-label={label}>
      <div className={`marquee-track ${direction}${duration ? " run" : ""}`} style={{ "--dur": `${duration ?? 60}s` } as CSSProperties}>
        <div className="marquee-group" ref={group}>{children}</div>
        <div className="marquee-group copy" aria-hidden inert>{children}</div>
      </div>
    </div>
  );
}

const NUMBER = /-?\d[\d,]*(?:\.\d+)?/g;
/** Only plain figures animate (prices, percents, 3.00T, "102.90 to 106.05"); dates and labels do not. */
function animatable(text: string): boolean {
  const rest = text.replace(NUMBER, "").replace(/\bto\b|[KMBTx]/g, "");
  return /\d/.test(text) && !/[A-Za-z]/.test(rest);
}
const parse = (text: string) => (text.match(NUMBER) ?? []).map((t) => Number(t.replace(/,/g, "")));
function render(text: string, values: number[]): string {
  let i = 0;
  return text.replace(NUMBER, (tok) => {
    const v = values[i++];
    const decimals = tok.split(".")[1]?.length ?? 0;
    return v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: tok.includes(",") });
  });
}

/** Last shown values per id, so a number that remounts (e.g. a price that flashes) continues from where it was. */
const memory = new Map<string, number[]>();

/** Text whose numbers count smoothly to their new values: from zero the first time, then from the previous value. */
export function CountText({ text, id, duration = 900 }: { text: string; id?: string; duration?: number }) {
  const [shown, setShown] = useState(text);
  const last = useRef<number[] | null>(id ? memory.get(id) ?? null : null);

  useIsoLayoutEffect(() => {
    const targets = parse(text);
    const remember = (v: number[]) => {
      last.current = v;
      if (id) memory.set(id, v);
    };
    if (!animatable(text) || reducedMotion()) {
      setShown(text);
      remember(targets);
      return;
    }
    const from = last.current && last.current.length === targets.length ? last.current : targets.map(() => 0);
    if (from.every((v, i) => v === targets[i])) {
      setShown(text);
      return;
    }
    let current = from;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / duration);
      const e = 1 - Math.pow(1 - k, 3); // ease out: fast start, gentle landing
      current = targets.map((t, i) => from[i] + (t - from[i]) * e);
      if (k < 1) {
        setShown(render(text, current));
        raf = requestAnimationFrame(tick);
      } else {
        setShown(text);
        remember(targets);
      }
    };
    setShown(render(text, from));
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      remember(current);
    };
  }, [text]);

  return <>{shown}</>;
}
