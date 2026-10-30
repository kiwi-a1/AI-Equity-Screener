"use client";
/** Company search with live suggestions as you type (debounced), keyboard navigation and click-to-select. */
import { useEffect, useRef, useState } from "react";

import type { ApiResult, SearchHit } from "@/lib/types";

export default function SearchBox({ onSelect, autoFocus = false }: { onSelect: (symbol: string) => void; autoFocus?: boolean }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        const body = (await res.json()) as ApiResult<SearchHit[]>;
        setHits(body.data ?? []);
        setActive(0);
        setOpen(true);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setHits([]);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 220);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const choose = (symbol: string) => {
    onSelect(symbol);
    setQuery("");
    setHits([]);
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (hits[active]) choose(hits[active].symbol);
      else if (/^[A-Za-z0-9^][A-Za-z0-9.\-=^]{0,19}$/.test(query.trim())) choose(query.trim().toUpperCase());
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const showList = open && query.trim().length > 0;
  return (
    <div className="search-wrap" ref={boxRef}>
      <input
        className="search-input"
        type="search"
        placeholder="Search a company or ticker, for example Apple, MSFT, Reliance"
        value={query}
        autoFocus={autoFocus}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        role="combobox"
        aria-expanded={showList}
        aria-controls="search-suggestions"
        aria-autocomplete="list"
        aria-label="Search companies"
      />
      {showList ? (
        <ul className="suggest" id="search-suggestions" role="listbox">
          {hits.length ? (
            hits.map((h, i) => (
              <li
                key={h.symbol}
                role="option"
                aria-selected={i === active}
                className={i === active ? "active" : ""}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(h.symbol);
                }}
              >
                <span className="sym">{h.symbol}</span>
                <span>{h.name}</span>
                <span className="exch">{[h.exchange, h.type].filter(Boolean).join(", ")}</span>
              </li>
            ))
          ) : (
            <li className="empty">{loading ? "Searching" : "No matching companies"}</li>
          )}
        </ul>
      ) : null}
    </div>
  );
}
