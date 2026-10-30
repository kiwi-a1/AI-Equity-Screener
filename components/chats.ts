/**
 * Saved chats, kept in this browser. Each chat belongs to one company (or to the home page when
 * `symbol` is null), and each company remembers which of its chats was open last.
 */
import type { Sources } from "@/lib/ai/events";

export interface Message {
  role: "user" | "assistant";
  text: string;
  sources?: Sources;
  steps?: string[];
  error?: string;
}

export interface Chat {
  id: string;
  symbol: string | null;
  name: string | null;
  title: string;
  messages: Message[];
  history: unknown[];
  provider: string | null;
  updatedAt: number;
}

export interface ChatStore {
  chats: Chat[];
  /** Last open chat per company; key "" is the home page. */
  active: Record<string, string>;
}

const KEY = "equity-screener-chats-v2";
const MAX_CHATS = 60;

export const symKey = (symbol: string | null) => symbol ?? "";

export function newChat(symbol: string | null, name: string | null): Chat {
  return { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, symbol, name, title: "New chat", messages: [], history: [], provider: null, updatedAt: Date.now() };
}

export function titleFrom(question: string): string {
  const t = question.replace(/\s+/g, " ").trim();
  return t.length > 48 ? `${t.slice(0, 46).trimEnd()}...` : t;
}

export function loadStore(): ChatStore {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null") as ChatStore | null;
    if (s && Array.isArray(s.chats)) return { chats: s.chats, active: s.active ?? {} };
  } catch {
    /* storage unavailable or corrupt */
  }
  return { chats: [], active: {} };
}

/** Saves chats that have messages; the oldest are dropped past the limit. */
export function saveStore(store: ChatStore): void {
  try {
    const chats = store.chats.filter((c) => c.messages.length).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CHATS);
    localStorage.setItem(KEY, JSON.stringify({ chats, active: store.active }));
  } catch {
    /* storage full or unavailable: chats last for this visit */
  }
}
