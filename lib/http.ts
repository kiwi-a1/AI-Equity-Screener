/** Helpers shared by the API route handlers. */
import { NextResponse } from "next/server";

import { describeError } from "./cache";
import { InputError } from "./data";
import type { ApiResult } from "./types";

/** JSON response with CDN caching (stale-while-revalidate) for successful, non-stale results. */
export function json<T>(result: ApiResult<T>, cacheSeconds: number): NextResponse {
  const headers: Record<string, string> = {};
  if (result.data !== null && !result.stale && cacheSeconds > 0) {
    headers["Cache-Control"] = `public, s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 4}`;
  } else {
    headers["Cache-Control"] = "no-store";
  }
  const status = result.data === null && result.error ? 502 : 200;
  return NextResponse.json(result, { status, headers });
}

/** Run a handler, mapping bad input to 400 and anything unexpected to a 500 with a readable message. */
export async function handle(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (err) {
    const status = err instanceof InputError ? 400 : 500;
    const body: ApiResult<null> = { data: null, fetchedAt: null, stale: false, error: describeError(err) };
    return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  }
}

export function param(url: URL, name: string): string {
  return (url.searchParams.get(name) ?? "").trim();
}
