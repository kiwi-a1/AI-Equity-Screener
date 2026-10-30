"use client";
/** Small fetch hook for the app's own API routes (which all return ApiResult<T>). */
import { useCallback, useEffect, useRef, useState } from "react";

import type { ApiResult } from "@/lib/types";

export interface ApiState<T> {
  data: T | null;
  error: string | null;
  stale: boolean;
  loading: boolean;
  fetchedAt: string | null;
  headers: Headers | null;
  reload: () => void;
}

export function useApi<T>(url: string | null, { refreshMs = 0 } = {}): ApiState<T> {
  const [state, setState] = useState<Omit<ApiState<T>, "reload">>({ data: null, error: null, stale: false, loading: !!url, fetchedAt: null, headers: null });
  const [nonce, setNonce] = useState(0);
  const urlRef = useRef(url);

  useEffect(() => {
    urlRef.current = url;
    if (!url) {
      setState({ data: null, error: null, stale: false, loading: false, fetchedAt: null, headers: null });
      return;
    }
    let cancelled = false;
    const ctrl = new AbortController();
    const load = async (background: boolean) => {
      if (!background) setState((s) => ({ ...s, loading: true, error: null, ...(urlRef.current !== url ? { data: null } : {}) }));
      try {
        const res = await fetch(url, { signal: ctrl.signal, cache: nonce ? "no-store" : "default" });
        const body = (await res.json()) as ApiResult<T>;
        if (cancelled) return;
        setState({ data: body.data, error: body.error, stale: body.stale, loading: false, fetchedAt: body.fetchedAt, headers: res.headers });
      } catch (err) {
        if (cancelled || (err as Error).name === "AbortError") return;
        setState((s) => ({ ...s, loading: false, error: "Could not reach the server. Check your connection and try again." }));
      }
    };
    setState((s) => ({ ...s, data: null }));
    load(false);
    const timer = refreshMs > 0 ? setInterval(() => load(true), refreshMs) : null;
    return () => {
      cancelled = true;
      ctrl.abort();
      if (timer) clearInterval(timer);
    };
  }, [url, refreshMs, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}
