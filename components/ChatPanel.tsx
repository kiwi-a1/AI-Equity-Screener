"use client";
/**
 * AI analyst panel, always visible on the right. Chats are company-specific: opening a company opens its
 * last chat (or a fresh one), and coming back to a company brings its chat back. Every chat is kept in
 * the chat list, where it can be reopened or deleted. Follows the selected section (sent as context with
 * every question) and offers follow-up questions after each answer. Streams answers from /api/chat.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { ChatEvent, ChatRequest, Sources } from "@/lib/ai/events";
import { splitFollowUps, SUGGESTED_PROMPTS } from "@/lib/ai/prompt";
import { fmtDate, timeAgo } from "@/lib/format";
import { SECTIONS, type CompanyInfo, type PageContext } from "@/lib/types";

import { loadStore, newChat, saveStore, symKey, titleFrom, type Chat, type ChatStore, type Message } from "./chats";

export interface ChatHandle {
  ask: (question: string) => void;
}

interface Props {
  symbol: string | null;
  info: CompanyInfo | null;
  context: PageContext | null;
  /** Opens a company page (null for the home page) when a chat from another company is chosen. */
  onOpenCompany: (symbol: string | null) => void;
}

const HOME_PROMPTS = ["Summarize today's market news and what is driving stocks", "Which large technology companies have the strongest margins?", "Explain what a P/E ratio tells an investor"];

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

const ChatPanel = forwardRef<ChatHandle, Props>(function ChatPanel({ symbol, info, context, onOpenCompany }, ref) {
  const [store, setStore] = useState<ChatStore>({ chats: [], active: {} });
  const [loaded, setLoaded] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [input, setInput] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null); // the chat being answered right now
  const [status, setStatus] = useState("");
  const [showList, setShowList] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false); // phones: chat opens as a full-screen sheet
  const bodyRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const companyName = info?.name ?? null;

  // Restore saved chats and check whether the AI is configured.
  useEffect(() => {
    setStore(loadStore());
    setLoaded(true);
    fetch("/api/chat")
      .then((r) => r.json())
      .then((b: { provider: string | null }) => setConfigured(!!b.provider))
      .catch(() => setConfigured(false));
  }, []);

  useEffect(() => {
    if (loaded) saveStore(store);
  }, [store, loaded]);

  // Each company has its own chat: reopen its last one, or start a fresh one.
  useEffect(() => {
    if (!loaded) return;
    setStore((s) => {
      const k = symKey(symbol);
      if (s.chats.some((c) => c.id === s.active[k] && c.symbol === symbol)) return s;
      const recent = s.chats.filter((c) => c.symbol === symbol).sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (recent) return { ...s, active: { ...s.active, [k]: recent.id } };
      const c = newChat(symbol, companyName);
      return { chats: [c, ...s.chats], active: { ...s.active, [k]: c.id } };
    });
  }, [symbol, loaded, store, companyName]);

  const chat: Chat | null = store.chats.find((c) => c.id === store.active[symKey(symbol)] && c.symbol === symbol) ?? null;
  const messages = chat?.messages ?? [];
  const busy = busyId !== null;
  const busyHere = busyId !== null && busyId === chat?.id;

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [messages, status, chat?.id]);

  const updateChat = useCallback((id: string, fn: (c: Chat) => Chat) => {
    setStore((s) => ({ ...s, chats: s.chats.map((c) => (c.id === id ? fn(c) : c)) }));
  }, []);

  const send = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || busy || !chat) return;
      const id = chat.id;
      setBusyId(id);
      setStatus("Thinking");
      setInput("");
      setShowList(false);
      updateChat(id, (c) => ({
        ...c,
        name: c.name ?? companyName,
        title: c.messages.length ? c.title : titleFrom(q),
        updatedAt: Date.now(),
        messages: [...c.messages, { role: "user", text: q }, { role: "assistant", text: "", steps: [] }],
      }));
      // Updates always go to the chat that asked, even if the user has moved to another company.
      const update = (fn: (m: Message) => Message) =>
        updateChat(id, (c) => {
          const copy = [...c.messages];
          copy[copy.length - 1] = fn(copy[copy.length - 1]);
          return { ...c, messages: copy };
        });

      const body: ChatRequest = {
        message: q,
        history: chat.history,
        provider: chat.provider,
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
              updateChat(id, (c) => ({ ...c, history: ev.history, provider: ev.provider, updatedAt: Date.now() }));
            }
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") update((m) => ({ ...m, stopped: true }));
        else update((m) => ({ ...m, error: "The AI assistant could not respond. Please try again." }));
      } finally {
        setBusyId(null);
        setStatus("");
        abortRef.current = null;
      }
    },
    [busy, chat, symbol, info, context, companyName, updateChat],
  );

  useImperativeHandle(ref, () => ({ ask: (q: string) => { setMobileOpen(true); void send(q); } }), [send]);

  useEffect(() => {
    // Lock page scroll behind the full-screen chat on phones.
    document.body.classList.toggle("chat-open", mobileOpen);
    return () => document.body.classList.remove("chat-open");
  }, [mobileOpen]);

  /** A fresh chat for the current company (reuses an empty one rather than piling them up). */
  const startNew = () => {
    setShowList(false);
    setStore((s) => {
      const k = symKey(symbol);
      const empty = s.chats.find((c) => c.symbol === symbol && !c.messages.length);
      if (empty) return { ...s, active: { ...s.active, [k]: empty.id } };
      const c = newChat(symbol, companyName);
      return { chats: [c, ...s.chats], active: { ...s.active, [k]: c.id } };
    });
  };

  const openChat = (c: Chat) => {
    setStore((s) => ({ ...s, active: { ...s.active, [symKey(c.symbol)]: c.id } }));
    setShowList(false);
    if (c.symbol !== symbol) onOpenCompany(c.symbol);
  };

  const deleteChat = (c: Chat) => {
    if (busyId === c.id) abortRef.current?.abort();
    setStore((s) => {
      const active = { ...s.active };
      if (active[symKey(c.symbol)] === c.id) delete active[symKey(c.symbol)];
      return { chats: s.chats.filter((x) => x.id !== c.id), active };
    });
  };

  // Saved chats, this company's first, newest first within each group.
  const saved = useMemo(() => store.chats.filter((c) => c.messages.length).sort((a, b) => b.updatedAt - a.updatedAt), [store.chats]);
  const here = saved.filter((c) => c.symbol === symbol);
  const elsewhere = saved.filter((c) => c.symbol !== symbol);

  const sectionLabel = context ? SECTIONS.find((s) => s.id === context.section)?.label : null;
  const starters = context ? SUGGESTED_PROMPTS[context.section] : HOME_PROMPTS;
  const last = messages[messages.length - 1];
  const asked = new Set(messages.filter((m) => m.role === "user").map((m) => m.text));
  // After an answer: the follow-ups the analyst suggested, or else this section's starters not yet asked.
  const followUps =
    last?.role === "assistant" && !busyHere && last.text
      ? (() => {
          const f = splitFollowUps(last.text).followUps.filter((q) => !asked.has(q));
          return f.length ? f : starters.filter((q) => !asked.has(q)).slice(0, 3);
        })()
      : [];

  const Thinking = ({ text }: { text: string }) => (
    <div className="status" role="status">
      {text.replace(/\.+$/, "")}
      <span className="typing" aria-hidden><i /><i /><i /></span>
    </div>
  );

  const ChatRow = ({ c }: { c: Chat }) => (
    <li className={c.id === chat?.id ? "on" : ""}>
      <button type="button" className="open" onClick={() => openChat(c)}>
        <span className="t">{c.title}</span>
        <span className="m">
          {c.symbol ? <strong>{c.symbol}</strong> : <strong>Markets</strong>} · {timeAgo(new Date(c.updatedAt).toISOString())} · {Math.ceil(c.messages.length / 2)} {c.messages.length > 2 ? "questions" : "question"}
        </span>
      </button>
      <button type="button" className="del" onClick={() => deleteChat(c)} aria-label={`Delete chat: ${c.title}`} title="Delete chat">
        Delete
      </button>
    </li>
  );

  const subject = symbol ? info?.name ?? symbol : "the markets";

  return (
    <>
    <button type="button" className={`chat-fab${busy ? " busy" : ""}`} onClick={() => setMobileOpen(true)} aria-label="Open the AI analyst">
      <span className="dot" aria-hidden /> AI Analyst
    </button>
    <div className={`chat-scrim${mobileOpen ? " open" : ""}`} onClick={() => setMobileOpen(false)} aria-hidden />
    <aside className={`chat-col${mobileOpen ? " open" : ""}`} aria-label="AI analyst">
      <button type="button" className="chat-grip" onClick={() => setMobileOpen(false)} aria-label="Close the AI analyst" />
      <div className="chat-head">
        <div className="row">
          <h2><span className="dot" aria-hidden />AI Analyst</h2>
          <span style={{ display: "flex", gap: 8 }}>
            <button className={`btn ghost${showList ? " on" : ""}`} type="button" onClick={() => setShowList((v) => !v)} aria-expanded={showList}>
              Chats{saved.length ? ` (${saved.length})` : ""}
            </button>
            <button className="btn ghost" type="button" onClick={startNew} disabled={!messages.length}>
              New chat
            </button>
            <button className="btn ghost chat-close" type="button" onClick={() => setMobileOpen(false)} aria-label="Close the AI analyst">
              Close
            </button>
          </span>
        </div>
        <div className="ctx">
          {chat?.messages.length ? `${chat.title} · ` : ""}
          {symbol ? `About ${subject}${sectionLabel ? `, ${sectionLabel}` : ""}` : "About the markets. Select a company for a company chat"}
        </div>
      </div>
      {showList ? (
        <div className="chat-body chat-list">
          <div className="group">{symbol ? `Chats about ${subject}` : "Market chats"}</div>
          {here.length ? <ul>{here.map((c) => <ChatRow key={c.id} c={c} />)}</ul> : <p className="muted small">No saved chats here yet. Ask a question to start one.</p>}
          <button type="button" className="btn ghost" onClick={startNew} style={{ marginBottom: 14 }}>
            Start a new chat about {subject}
          </button>
          {elsewhere.length ? (
            <>
              <div className="group">Other companies</div>
              <ul>{elsewhere.map((c) => <ChatRow key={c.id} c={c} />)}</ul>
            </>
          ) : null}
        </div>
      ) : (
      <div className="chat-body" ref={bodyRef}>
        {configured === false ? (
          <div className="notice warn">
            The AI assistant is not available yet. Please check back soon.
          </div>
        ) : null}
        {!messages.length ? (
          <>
            <p className="muted" style={{ fontStyle: "italic" }}>
              {symbol
                ? `This chat is about ${subject}. Ask about the company, compare it with peers, or research recent developments. Each company keeps its own chats.`
                : "Ask about the markets, or select a company to start a chat about it. Each company keeps its own chats."}
            </p>
            <div className="suggestions">
              {starters.map((s) => (
                <button key={s} type="button" onClick={() => send(s)} disabled={busy || configured === false}>
                  {s}
                </button>
              ))}
            </div>
          </>
        ) : null}
        {messages.map((m, i) => {
          const isLast = i === messages.length - 1;
          const text = m.role === "assistant" ? splitFollowUps(m.text).body : m.text;
          return (
            <div className={`msg ${m.role}`} key={i}>
              <div className="who">{m.role === "user" ? "You" : "Analyst"}</div>
              <div className="text">
                {m.role === "assistant" ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: (p) => <a {...p} target="_blank" rel="noopener noreferrer" /> }}>{text}</ReactMarkdown> : text}
                {m.role === "assistant" && !text && busyHere && isLast ? <Thinking text={status || "Thinking"} /> : null}
                {m.role === "assistant" && text && busyHere && isLast && status ? <Thinking text={status} /> : null}
              </div>
              {m.stopped ? <div className="muted small" style={{ fontStyle: "italic", marginTop: 4 }}>Stopped</div> : null}
              {m.error ? <div className="err small">{m.error}</div> : null}
              {m.role === "assistant" && !(busyHere && isLast) ? <Evidence sources={m.sources} steps={m.steps} /> : null}
            </div>
          );
        })}
        {followUps.length ? (
          <div className="suggestions follow">
            <div className="who">Ask next</div>
            {followUps.map((s) => (
              <button key={s} type="button" onClick={() => send(s)} disabled={busy || configured === false}>
                {s}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      )}
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
          {busy ? (
            <button className="btn stop" type="button" onClick={() => abortRef.current?.abort()} aria-label="Stop the answer">
              <span className="sq" aria-hidden /> Stop
            </button>
          ) : (
            <button className="btn" type="submit" disabled={!input.trim() || configured === false}>
              Ask
            </button>
          )}
        </div>
      </form>
    </aside>
    </>
  );
});

export default ChatPanel;
