"use client";
/**
 * AI analyst panel, always visible on the right. Follows the selected company and section (sent as
 * context with every question). Streams answers from /api/chat (NDJSON ChatEvents).
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { ChatEvent, ChatRequest, Sources } from "@/lib/ai/events";
import { SUGGESTED_PROMPTS } from "@/lib/ai/prompt";
import { fmtDate, timeAgo } from "@/lib/format";
import { SECTIONS, type CompanyInfo, type PageContext } from "@/lib/types";

interface Message {
  role: "user" | "assistant";
  text: string;
  sources?: Sources;
  steps?: string[];
  error?: string;
}

export interface ChatHandle {
  ask: (question: string) => void;
}

interface Props {
  symbol: string | null;
  info: CompanyInfo | null;
  context: PageContext | null;
}

const STORE_KEY = "equity-screener-chat-v1";

function Evidence({ sources, steps }: { sources?: Sources; steps?: string[] }) {
  if (!sources && !steps?.length) return null;
  const web = sources?.web ?? [];
  const data = sources?.data ?? [];
  if (!web.length && !data.length && !steps?.length) return null;
  const seen = new Set<string>();
  return (
    <details>
      <summary>
        Sources and steps ({web.length} links, {data.length} data lookups)
      </summary>
      {data.length ? (
        <ul>
          {data
            .filter((d) => {
              const k = `${d.tool}:${d.symbol}`;
              if (seen.has(k)) return false;
              seen.add(k);
              return true;
            })
            .map((d, i) => (
              <li key={i}>
                {d.tool.replace(/_/g, " ")}
                {d.symbol ? ` for ${d.symbol}` : ""}, retrieved {timeAgo(d.retrievedAt)}
              </li>
            ))}
        </ul>
      ) : null}
      {web.length ? (
        <ul>
          {web.slice(0, 15).map((w) => (
            <li key={w.url}>
              <a href={w.url} target="_blank" rel="noopener noreferrer">{w.title}</a>
              {w.date ? `, ${fmtDate(w.date)}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {sources?.queries.length ? <div className="muted">Searched: {sources.queries.join("; ")}</div> : null}
      {steps?.length ? <div className="muted">Steps: {steps.join("; ")}</div> : null}
    </details>
  );
}

const ChatPanel = forwardRef<ChatHandle, Props>(function ChatPanel({ symbol, info, context }, ref) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [history, setHistory] = useState<unknown[]>([]);
  const [provider, setProvider] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false); // phones: chat opens as a full-screen sheet
  const bodyRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Restore the conversation for this browser tab and check which AI provider is configured.
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORE_KEY) ?? "null");
      if (saved) {
        setMessages(saved.messages ?? []);
        setHistory(saved.history ?? []);
        setProvider(saved.provider ?? null);
      }
    } catch {
      /* storage unavailable */
    }
    fetch("/api/chat")
      .then((r) => r.json())
      .then((b: { provider: string | null }) => setConfigured(!!b.provider))
      .catch(() => setConfigured(false));
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify({ messages, history, provider }));
    } catch {
      /* storage full or unavailable */
    }
  }, [messages, history, provider]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [messages, status]);

  const send = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || busy) return;
      setBusy(true);
      setStatus("Thinking");
      setInput("");
      setMessages((m) => [...m, { role: "user", text: q }, { role: "assistant", text: "", steps: [] }]);
      const update = (fn: (m: Message) => Message) =>
        setMessages((all) => {
          const copy = [...all];
          copy[copy.length - 1] = fn(copy[copy.length - 1]);
          return copy;
        });

      const body: ChatRequest = {
        message: q,
        history,
        provider,
        context: {
          symbol,
          company: info
            ? { name: info.name, exchange: info.exchange, currency: info.currency, sector: info.sector, industry: info.industry, price: info.price, changePercent: info.changePercent }
            : null,
          section: context ? SECTIONS.find((s) => s.id === context.section)?.label ?? context.section : null,
          filters: context?.filters ?? {},
          visible: context?.visible ?? {},
        },
      };
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal });
        if (!res.ok || !res.body) throw new Error(`Server returned ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl;
          while ((nl = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line) continue;
            const ev = JSON.parse(line) as ChatEvent;
            if (ev.type === "text") update((m) => ({ ...m, text: m.text + ev.text }));
            else if (ev.type === "status") setStatus(ev.text);
            else if (ev.type === "step") update((m) => ({ ...m, steps: [...(m.steps ?? []), ev.text.replace(/^Fetching /, "")] }));
            else if (ev.type === "error") update((m) => ({ ...m, error: ev.text }));
            else if (ev.type === "done") {
              update((m) => ({ ...m, sources: ev.sources }));
              setHistory(ev.history);
              setProvider(ev.provider);
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") update((m) => ({ ...m, error: `The analyst could not respond: ${(err as Error).message}` }));
      } finally {
        setBusy(false);
        setStatus("");
        abortRef.current = null;
      }
    },
    [busy, history, provider, symbol, info, context],
  );

  useImperativeHandle(ref, () => ({ ask: (q: string) => { setMobileOpen(true); void send(q); } }), [send]);

  useEffect(() => {
    // Lock page scroll behind the full-screen chat on phones.
    document.body.classList.toggle("chat-open", mobileOpen);
    return () => document.body.classList.remove("chat-open");
  }, [mobileOpen]);

  const reset = () => {
    abortRef.current?.abort();
    setMessages([]);
    setHistory([]);
    setStatus("");
    setBusy(false);
  };

  const sectionLabel = context ? SECTIONS.find((s) => s.id === context.section)?.label : null;
  const suggestions = context ? SUGGESTED_PROMPTS[context.section] : ["Summarize today's market news and what is driving stocks", "Which large technology companies have the strongest margins?", "Explain what a P/E ratio tells an investor"];

  const Thinking = ({ text }: { text: string }) => (
    <div className="status" role="status">
      {text.replace(/\.+$/, "")}
      <span className="typing" aria-hidden><i /><i /><i /></span>
    </div>
  );

  return (
    <>
    <button type="button" className={`chat-fab${busy ? " busy" : ""}`} onClick={() => setMobileOpen(true)} aria-label="Open the AI analyst">
      <span className="dot" aria-hidden /> Ask AI
    </button>
    <aside className={`chat-col${mobileOpen ? " open" : ""}`} aria-label="AI analyst">
      <div className="chat-head">
        <div className="row">
          <h2><span className="dot" aria-hidden />AI Analyst</h2>
          <span style={{ display: "flex", gap: 8 }}>
            <button className="btn ghost" type="button" onClick={reset} disabled={!messages.length && !busy}>
              New chat
            </button>
            <button className="btn ghost chat-close" type="button" onClick={() => setMobileOpen(false)} aria-label="Close the AI analyst">
              Close
            </button>
          </span>
        </div>
        <div className="ctx">{symbol ? `Following ${info?.name ?? symbol}${sectionLabel ? `, ${sectionLabel}` : ""}` : "Select a company to give the analyst context"}</div>
      </div>
      <div className="chat-body" ref={bodyRef}>
        {configured === false ? (
          <div className="notice warn">
            The analyst is not configured yet. Add <strong>GEMINI_API_KEY</strong> or <strong>ANTHROPIC_API_KEY</strong> to the site&apos;s environment variables and redeploy.
          </div>
        ) : null}
        {!messages.length ? (
          <>
            <p className="muted" style={{ fontStyle: "italic" }}>
              Ask about the selected company, compare it with peers, or research recent developments. Answers separate reported data, calculations, outside evidence and interpretation.
            </p>
            <div className="suggestions">
              {suggestions.map((s) => (
                <button key={s} type="button" onClick={() => send(s)} disabled={busy || configured === false}>
                  {s}
                </button>
              ))}
            </div>
          </>
        ) : null}
        {messages.map((m, i) => (
          <div className={`msg ${m.role}`} key={i}>
            <div className="who">{m.role === "user" ? "You" : "Analyst"}</div>
            <div className="text">
              {m.role === "assistant" ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: (p) => <a {...p} target="_blank" rel="noopener noreferrer" /> }}>{m.text}</ReactMarkdown> : m.text}
              {m.role === "assistant" && !m.text && busy && i === messages.length - 1 ? <Thinking text={status || "Thinking"} /> : null}
              {m.role === "assistant" && m.text && busy && i === messages.length - 1 && status ? <Thinking text={status} /> : null}
            </div>
            {m.error ? <div className="err small">{m.error}</div> : null}
            {m.role === "assistant" && !(busy && i === messages.length - 1) ? <Evidence sources={m.sources} steps={m.steps} /> : null}
          </div>
        ))}
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <textarea
          value={input}
          placeholder={symbol ? `Ask about ${symbol}` : "Ask the analyst"}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          disabled={configured === false}
          aria-label="Question for the analyst"
        />
        <div className="row">
          <span className="hint">AI analysis can be wrong. Not investment advice.</span>
          <button className="btn" type="submit" disabled={busy || !input.trim() || configured === false}>
            {busy ? "Working" : "Ask"}
          </button>
        </div>
      </form>
    </aside>
    </>
  );
});

export default ChatPanel;
