import { useEffect, useMemo, useRef, useState } from 'react';
import { sendChatStream, type ChatEngine, type ChatTurn } from '../api/client';

const WELCOME: ChatTurn = {
  role: 'assistant',
  content:
    "Hi! I'm the MSX Milestone Assistant. Ask me about opportunities, milestones, or dashboard " +
    'metrics — I can also create or update records (I\'ll confirm first). This is mock data.',
};

const ENGINE_LABELS: Record<ChatEngine, string> = {
  'in-app': 'In-app agents',
  foundry: 'Foundry hosted agent',
};

/** A saved conversation ("chat page"), Copilot-style. */
interface Conversation {
  id: string;
  title: string;
  engine: ChatEngine;
  messages: ChatTurn[];
  updatedAt: number;
}

const CONVERSATIONS_KEY = 'msx-chat-conversations';
const ACTIVE_KEY = 'msx-chat-active';
const LEGACY_TRANSCRIPT_KEY = 'msx-chat-transcript';
const LEGACY_ENGINE_KEY = 'msx-chat-engine';

function genId(): string {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID();
  } catch {
    /* ignore */
  }
  return `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function deriveTitle(messages: ChatTurn[]): string {
  const firstUser = messages.find((m) => m.role === 'user')?.content?.trim();
  if (!firstUser) return 'New chat';
  return firstUser.length > 42 ? `${firstUser.slice(0, 42)}…` : firstUser;
}

function newConversation(engine: ChatEngine = 'in-app'): Conversation {
  return { id: genId(), title: 'New chat', engine, messages: [], updatedAt: Date.now() };
}

function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(CONVERSATIONS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Conversation[]) : null;
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch {
    /* ignore corrupt storage */
  }
  // Migrate the previous single-transcript format into one conversation.
  try {
    const legacy = localStorage.getItem(LEGACY_TRANSCRIPT_KEY);
    const msgs = legacy ? (JSON.parse(legacy) as ChatTurn[]) : null;
    const engine = localStorage.getItem(LEGACY_ENGINE_KEY);
    if (Array.isArray(msgs) && msgs.length) {
      const eng: ChatEngine = engine === 'foundry' ? 'foundry' : 'in-app';
      localStorage.removeItem(LEGACY_TRANSCRIPT_KEY);
      return [{ id: genId(), title: deriveTitle(msgs), engine: eng, messages: msgs, updatedAt: Date.now() }];
    }
  } catch {
    /* ignore */
  }
  return [];
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    const loaded = loadConversations();
    return loaded.length ? loaded : [newConversation()];
  });
  const [activeId, setActiveId] = useState<string>(() => localStorage.getItem(ACTIVE_KEY) ?? '');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Keep a valid active conversation at all times.
  useEffect(() => {
    if (!conversations.some((c) => c.id === activeId)) {
      setActiveId(conversations[0]?.id ?? '');
    }
  }, [conversations, activeId]);

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? conversations[0],
    [conversations, activeId],
  );

  const orderedChats = useMemo(
    () => [...conversations].sort((a, b) => b.updatedAt - a.updatedAt),
    [conversations],
  );

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [active?.messages, busy, open]);

  // Persist conversations + which one is active.
  useEffect(() => {
    try {
      localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations));
    } catch {
      /* storage may be unavailable (private mode, quota) */
    }
  }, [conversations]);
  useEffect(() => {
    try {
      if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
    } catch {
      /* ignore */
    }
  }, [activeId]);

  function newChat() {
    const c = newConversation(active?.engine ?? 'in-app');
    setConversations((prev) => [c, ...prev]);
    setActiveId(c.id);
    setInput('');
    setError(null);
  }

  function selectChat(id: string) {
    setActiveId(id);
    setInput('');
    setError(null);
  }

  function deleteChat(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setConversations((prev) => {
      const remaining = prev.filter((c) => c.id !== id);
      if (remaining.length === 0) {
        const fresh = newConversation();
        setActiveId(fresh.id);
        return [fresh];
      }
      if (id === activeId) setActiveId(remaining[0].id);
      return remaining;
    });
  }

  function setEngine(engine: ChatEngine) {
    if (!active) return;
    setConversations((prev) => prev.map((c) => (c.id === active.id ? { ...c, engine } : c)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy || !active) return;
    const convoId = active.id;
    const engine = active.engine;
    const sentMsgs: ChatTurn[] = [...active.messages, { role: 'user', content: text }];

    // Add the user turn plus an empty assistant placeholder that fills as tokens stream in.
    setConversations((prev) =>
      prev.map((c) =>
        c.id === convoId
          ? {
              ...c,
              messages: [...sentMsgs, { role: 'assistant', content: '' }],
              title: c.messages.length === 0 ? deriveTitle(sentMsgs) : c.title,
              updatedAt: Date.now(),
            }
          : c,
      ),
    );
    setInput('');
    setError(null);
    setBusy(true);

    const appendToAssistant = (delta: string) =>
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== convoId) return c;
          const msgs = c.messages.slice();
          const last = msgs[msgs.length - 1];
          if (last && last.role === 'assistant') {
            msgs[msgs.length - 1] = { ...last, content: last.content + delta };
          }
          return { ...c, messages: msgs, updatedAt: Date.now() };
        }),
      );

    try {
      // Send the full running transcript so the agent keeps context across turns.
      await sendChatStream(sentMsgs, engine, appendToAssistant);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      // Drop the empty placeholder if the turn failed before any text arrived.
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== convoId) return c;
          const msgs = c.messages.slice();
          const last = msgs[msgs.length - 1];
          if (last && last.role === 'assistant' && last.content === '') msgs.pop();
          return { ...c, messages: msgs };
        }),
      );
    } finally {
      setBusy(false);
    }
  }

  const lastMsg = active?.messages[active.messages.length - 1];
  const lastIsEmptyAssistant = !!lastMsg && lastMsg.role === 'assistant' && lastMsg.content === '';

  if (!open) {
    return (
      <button className="chat-fab" onClick={() => setOpen(true)} aria-label="Open assistant">
        💬 Assistant
      </button>
    );
  }

  return (
    <div className="chat-panel" role="dialog" aria-label="MSX Milestone Assistant">
      <div className={`chat-shell ${railOpen ? 'rail-open' : ''}`}>
        {/* History rail */}
        <aside className="chat-rail">
          <div className="chat-rail-head">
            <span>Chats</span>
            <button className="chat-newbtn" onClick={newChat} title="Start a new chat">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              New chat
            </button>
          </div>
          <div className="chat-rail-list">
            {orderedChats.map((c) => (
              <button
                key={c.id}
                className={`chat-rail-item ${c.id === active?.id ? 'active' : ''}`}
                onClick={() => selectChat(c.id)}
                title={c.title}
              >
                <svg className="rail-ico" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5z" />
                </svg>
                <span className="rail-title">{c.title}</span>
                <span
                  className="rail-del"
                  role="button"
                  aria-label="Delete chat"
                  title="Delete chat"
                  onClick={(e) => deleteChat(c.id, e)}
                >
                  ×
                </span>
              </button>
            ))}
          </div>
        </aside>

        {/* Main chat area */}
        <div className="chat-main">
          <div className="chat-header">
            <div>
              <button
                className="icon-btn rail-toggle"
                aria-label={railOpen ? 'Hide chats' : 'Show chats'}
                title={railOpen ? 'Hide chats' : 'Show chats'}
                onClick={() => setRailOpen((v) => !v)}
              >
                ☰
              </button>
              <strong>Assistant</strong>
              <select
                className="chat-engine"
                value={active?.engine ?? 'in-app'}
                onChange={(e) => setEngine(e.target.value as ChatEngine)}
                title="Which engine answers your messages"
              >
                <option value="in-app">{ENGINE_LABELS['in-app']}</option>
                <option value="foundry">{ENGINE_LABELS.foundry}</option>
              </select>
            </div>
            <div>
              <button className="icon-btn" aria-label="New chat" title="Start a new chat" onClick={newChat}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
              <button className="icon-btn" aria-label="Close" onClick={() => setOpen(false)}>
                ×
              </button>
            </div>
          </div>

          <div className="chat-messages" ref={listRef}>
            <div className="chat-msg assistant">{WELCOME.content}</div>
            {active?.messages.map((m, i) =>
              m.role === 'assistant' && m.content === '' ? null : (
                <div key={i} className={`chat-msg ${m.role}`}>
                  {m.content}
                </div>
              ),
            )}
            {busy && lastIsEmptyAssistant && <div className="chat-msg assistant muted">Thinking…</div>}
            {error && <div className="chat-msg error">{error}</div>}
          </div>

          <form className="chat-input" onSubmit={submit}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about milestones, opportunities, metrics…"
              disabled={busy}
              autoFocus
            />
            <button type="submit" disabled={busy || !input.trim()}>
              Send
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
