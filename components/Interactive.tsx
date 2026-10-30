"use client";
/**
 * Pointer-driven polish, kept subtle: a soft light that follows the cursor, a spotlight and glowing edge
 * on the glass panel under it, gentle parallax on the background, and a ripple on clicks. Everything is
 * driven by CSS variables, so the work per frame is tiny. Hover effects are skipped on touch screens,
 * and all motion is skipped for people who ask their device to reduce motion.
 */
import { useEffect, useRef } from "react";

const SPOT = ".block, .co-head, .masthead, .strip button, .news-item, .resources li a, .suggestions button, .tabs button, .market-news li, .msg .text";
const RIPPLE = "button, .strip button, .resources li a, .news-item, .tabs button";

export default function Interactive() {
  const glow = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const root = document.documentElement;
    const fine = window.matchMedia("(pointer: fine)").matches;
    let x = innerWidth / 2, y = innerHeight / 3, gx = x, gy = y, frame = 0;
    let lit: HTMLElement | null = null;
    const orbs = document.querySelector<HTMLElement>(".orbs");

    const tick = () => {
      // Ease the cursor light towards the pointer so it trails smoothly.
      gx += (x - gx) * 0.14;
      gy += (y - gy) * 0.14;
      if (glow.current) glow.current.style.transform = `translate3d(${gx}px, ${gy}px, 0)`;
      if (orbs) orbs.style.transform = `translate3d(${((gx / innerWidth - 0.5) * -36).toFixed(1)}px, ${((gy / innerHeight - 0.5) * -28).toFixed(1)}px, 0)`;
      frame = Math.abs(x - gx) + Math.abs(y - gy) > 0.5 ? requestAnimationFrame(tick) : 0;
    };

    const move = (e: PointerEvent) => {
      x = e.clientX;
      y = e.clientY;
      if (!frame) frame = requestAnimationFrame(tick);
      if (!fine) return;
      root.classList.add("pointer-on");
      const el = (e.target as Element | null)?.closest?.(SPOT) as HTMLElement | null;
      if (lit && lit !== el) lit.classList.remove("lit");
      lit = el;
      if (el) {
        const r = el.getBoundingClientRect();
        el.style.setProperty("--mx", `${e.clientX - r.left}px`);
        el.style.setProperty("--my", `${e.clientY - r.top}px`);
        el.classList.add("lit");
      }
    };
    const leave = () => {
      root.classList.remove("pointer-on");
      lit?.classList.remove("lit");
      lit = null;
    };
    const down = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.(RIPPLE) as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const size = Math.max(r.width, r.height) * 2;
      const dot = document.createElement("span");
      dot.className = "ripple";
      dot.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
      if (getComputedStyle(el).position === "static") el.classList.add("ripple-host");
      el.appendChild(dot);
      dot.addEventListener("animationend", () => dot.remove());
    };

    addEventListener("pointermove", move, { passive: true });
    addEventListener("pointerdown", down, { passive: true });
    document.addEventListener("pointerleave", leave);
    return () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerdown", down);
      document.removeEventListener("pointerleave", leave);
      cancelAnimationFrame(frame);
    };
  }, []);

  return <div ref={glow} className="cursor-glow" aria-hidden />;
}
