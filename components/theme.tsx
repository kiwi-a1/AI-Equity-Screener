"use client";
/** Dark / light theme: a toggle button and a hook. The choice is stored per browser; first visit follows the device setting. */
import { useEffect, useState } from "react";

export type Theme = "dark" | "light";
export const THEME_KEY = "equity-screener-theme";

/** Runs before first paint (inlined in app/layout.tsx) so the page never flashes the wrong theme. */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="dark"}})();`;

function current(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

/** Current theme, updated live when the toggle changes it. */
export function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => {
    setTheme(current());
    const obs = new MutationObserver(() => setTheme(current()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

export function ThemeToggle() {
  const theme = useTheme();
  const next: Theme = theme === "dark" ? "light" : "dark";
  const toggle = () => {
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* storage unavailable: the choice lasts for this visit */
    }
  };
  return (
    <button type="button" className="theme-toggle" onClick={toggle} aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}>
      <span className={`opt ${theme === "dark" ? "on" : ""}`}>Dark</span>
      <span className={`opt ${theme === "light" ? "on" : ""}`}>Light</span>
    </button>
  );
}
