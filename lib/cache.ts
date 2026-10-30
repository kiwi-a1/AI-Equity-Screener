/**
 * In-memory TTL cache with retries and stale-on-error fallback. On Vercel each warm function
 * instance keeps its own cache; API routes also send Cache-Control so the CDN absorbs repeat hits.
 */
import type { ApiResult } from "./types";

interface Entry {
  value: unknown;
  storedAt: number;
  fetchedAt: string;
}

const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<ApiResult<unknown>>>();

export function describeError(err: unknown): string {
  if (err instanceof Error) {
    const name = err.name && err.name !== "Error" ? `${err.name}: ` : "";
    return `${name}${err.message}`.slice(0, 300);
  }
  return String(err).slice(0, 300);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function cached<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>,
  { retries = 2, backoffMs = 500 } = {},
): Promise<ApiResult<T>> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.storedAt < ttlSeconds * 1000) {
    return { data: hit.value as T, fetchedAt: hit.fetchedAt, stale: false, error: null };
  }
  const running = inflight.get(key);
  if (running) return running as Promise<ApiResult<T>>;

  const task = (async (): Promise<ApiResult<T>> => {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const value = await loader();
        const fetchedAt = new Date().toISOString();
        store.set(key, { value, storedAt: Date.now(), fetchedAt });
        return { data: value, fetchedAt, stale: false, error: null };
      } catch (err) {
        lastErr = err;
        if (attempt < retries) await sleep(backoffMs * 2 ** attempt);
      }
    }
    const error = describeError(lastErr);
    if (hit) return { data: hit.value as T, fetchedAt: hit.fetchedAt, stale: true, error };
    return { data: null, fetchedAt: null, stale: false, error };
  })();

  inflight.set(key, task as Promise<ApiResult<unknown>>);
  try {
    return await task;
  } finally {
    inflight.delete(key);
  }
}

export function invalidate(prefix = ""): number {
  let n = 0;
  for (const k of [...store.keys()]) {
    if (k.startsWith(prefix)) {
      store.delete(k);
      n++;
    }
  }
  return n;
}
