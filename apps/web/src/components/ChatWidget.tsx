import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { sendChatStream, type ChatEngine, type ChatTurn } from '../api/client';
import { authEnabled, msalInstance } from '../auth/msalConfig';

const WELCOME_TEXT =
  "Hi! I'm the **Multi-Agent Sales Assistant**. Ask me about opportunities, milestones, or dashboard " +
  "metrics — I can also create or update records (I'll confirm first). This is mock data.";

/** Ready-made prompts shown on an empty chat to remove the blank-page problem. */
const SUGGESTIONS = [
  'Show milestones at risk',
  'Summarize my open opportunities',
  'What needs approval right now?',
  'Which milestones are blocked?',
];

const ENGINE_LABELS: Record<ChatEngine, string> = {
  'in-app': 'In-app agents',
  foundry: 'Foundry hosted agent',
};

// Render assistant replies as GitHub-flavored Markdown. react-markdown does not
// emit raw HTML, so agent output can't inject markup (XSS-safe). External links
// open in a new tab. Memoized so already-rendered turns don't re-parse on every
// streamed token of the in-progress reply.
const mdComponents: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
};
const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
      {text}
    </ReactMarkdown>
  );
});

function formatTime(ts?: number): string {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

// Compact "2h ago"-style label for rail items, falling back to a short date
// once an entry is old enough that a relative label stops being useful.
function formatRelative(ts?: number): string {
  if (!ts) return '';
  const diffMs = Date.now() - ts;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) return 'Just now';
  if (diffMs < hour) return `${Math.floor(diffMs / minute)}m ago`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h ago`;
  if (diffMs < 2 * day) return 'Yesterday';
  if (diffMs < 7 * day) return `${Math.floor(diffMs / day)}d ago`;
  try {
    return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

const SendIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 2 11 13" />
    <path d="M22 2 15 22l-4-9-9-4 20-7z" />
  </svg>
);
const StopIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);
const CopyIcon = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);
const CheckIcon = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);
const AssistantAvatar = () => (
  <span className="chat-avatar assistant" aria-hidden="true">
    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
      <path d="M12 2l1.7 4.7L18.4 8l-4.7 1.3L12 14l-1.7-4.7L5.6 8l4.7-1.3L12 2z" />
      <path d="M18.5 12.5l.85 2.35L22 15.7l-2.65.85L18.5 19l-.85-2.45L15 15.7l2.65-.85.85-2.35z" />
    </svg>
  </span>
);
const UserAvatar = () => (
  <span className="chat-avatar user" aria-hidden="true">
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  </span>
);
const ExpandIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />
  </svg>
);
const CollapseIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
  </svg>
);
const RegenerateIcon = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
  </svg>
);
const EditIcon = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);
const ChatBubbleIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </svg>
);

/** A stored turn, plus a client-only timestamp (never sent to the API). */
type StoredTurn = ChatTurn & { ts?: number };

/** A saved conversation ("chat page"), Copilot-style. */
interface Conversation {
  id: string;
  title: string;
  engine: ChatEngine;
  messages: StoredTurn[];
  updatedAt: number;
}

const BASE_CONVERSATIONS_KEY = 'msx-chat-conversations';
const BASE_ACTIVE_KEY = 'msx-chat-active';
const LEGACY_TRANSCRIPT_KEY = 'msx-chat-transcript';

// Chat history is stored per signed-in user so it stays private on a shared
// browser — one user can never see another user's chats. The namespace is the
// MSAL account id (falls back to 'local' when auth is disabled for local dev).
const conversationsKey = (owner: string) => `${BASE_CONVERSATIONS_KEY}::${owner}`;
const activeKey = (owner: string) => `${BASE_ACTIVE_KEY}::${owner}`;
const railOpenKey = (owner: string) => `msx-chat-rail-open::${owner}`;

function chatOwnerKey(): string {
  if (authEnabled && msalInstance) {
    const acct = msalInstance.getActiveAccount() ?? msalInstance.getAllAccounts()[0];
    const id = acct?.homeAccountId ?? acct?.localAccountId ?? acct?.username;
    if (id) return id;
  }
  return 'local';
}

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

function newConversation(engine: ChatEngine = 'foundry'): Conversation {
  return { id: genId(), title: 'New chat', engine, messages: [], updatedAt: Date.now() };
}

function loadConversations(owner: string): Conversation[] {
  try {
    const raw = localStorage.getItem(conversationsKey(owner));
    const parsed = raw ? (JSON.parse(raw) as Conversation[]) : null;
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch {
    /* ignore corrupt storage */
  }
  // One-time migration of the older un-namespaced history — ONLY for local dev
  // (owner 'local'). Real accounts never inherit pre-existing shared history, so
  // a signed-in user can't see chats left by a different account on this browser.
  if (owner === 'local') {
    try {
      const rawOld = localStorage.getItem(BASE_CONVERSATIONS_KEY);
      const parsedOld = rawOld ? (JSON.parse(rawOld) as Conversation[]) : null;
      if (Array.isArray(parsedOld) && parsedOld.length) return parsedOld;
    } catch {
      /* ignore */
    }
    try {
      const legacy = localStorage.getItem(LEGACY_TRANSCRIPT_KEY);
      const msgs = legacy ? (JSON.parse(legacy) as ChatTurn[]) : null;
      if (Array.isArray(msgs) && msgs.length) {
        localStorage.removeItem(LEGACY_TRANSCRIPT_KEY);
        return [{ id: genId(), title: deriveTitle(msgs), engine: 'foundry', messages: msgs, updatedAt: Date.now() }];
      }
    } catch {
      /* ignore */
    }
  }
  return [];
}

export default function ChatWidget() {
  const ownerKey = useMemo(() => chatOwnerKey(), []);
  const [open, setOpen] = useState(false);
  const [railOpen, setRailOpen] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(railOpenKey(ownerKey));
      return raw === null ? true : raw === '1';
    } catch {
      return true;
    }
  });
  const [maximized, setMaximized] = useState(false);
  const [railSearch, setRailSearch] = useState('');
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    const loaded = loadConversations(ownerKey);
    return loaded.length ? loaded : [newConversation()];
  });
  const [activeId, setActiveId] = useState<string>(() => localStorage.getItem(activeKey(ownerKey)) ?? '');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showJump, setShowJump] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const atBottomRef = useRef(true);
  const retryRef = useRef<{ convoId: string; transcript: StoredTurn[] } | null>(null);

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

  const filteredChats = useMemo(() => {
    const q = railSearch.trim().toLowerCase();
    if (!q) return orderedChats;
    return orderedChats.filter((c) => c.title.toLowerCase().includes(q));
  }, [orderedChats, railSearch]);

  // Global shortcut (Ctrl/Cmd+/) to open or close the assistant from anywhere.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    atBottomRef.current = true;
    setShowJump(false);
  }, []);

  function onListScroll() {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    atBottomRef.current = nearBottom;
    setShowJump(!nearBottom);
  }

  // Auto-scroll on new content only when the user is already near the bottom, so
  // reading older messages while a reply streams doesn't yank the view down.
  useEffect(() => {
    if (atBottomRef.current) scrollToBottom();
  }, [active?.messages, busy, scrollToBottom]);

  // Opening the panel or switching chats jumps straight to the latest message.
  useEffect(() => {
    if (open) scrollToBottom('auto');
  }, [open, activeId, scrollToBottom]);

  // Persist conversations + which one is active.
  useEffect(() => {
    try {
      localStorage.setItem(conversationsKey(ownerKey), JSON.stringify(conversations));
    } catch {
      /* storage may be unavailable (private mode, quota) */
    }
  }, [conversations, ownerKey]);
  useEffect(() => {
    try {
      if (activeId) localStorage.setItem(activeKey(ownerKey), activeId);
    } catch {
      /* ignore */
    }
  }, [activeId, ownerKey]);
  useEffect(() => {
    try {
      localStorage.setItem(railOpenKey(ownerKey), railOpen ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [railOpen, ownerKey]);

  function newChat() {
    const c = newConversation('foundry');
    setConversations((prev) => [c, ...prev]);
    setActiveId(c.id);
    resetComposer();
    setError(null);
  }

  function selectChat(id: string) {
    setActiveId(id);
    resetComposer();
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

  // A textarea grows with its content up to a cap, then scrolls internally.
  function autoGrow(el: HTMLTextAreaElement | null) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }

  function resetComposer() {
    setInput('');
    if (taRef.current) taRef.current.style.height = 'auto';
  }

  // Runs one assistant turn. `transcript` must end with the user turn being
  // answered; we append an empty assistant bubble and stream tokens into it.
  const runTurn = useCallback(async (convoId: string, transcript: StoredTurn[]) => {
    retryRef.current = null;
    setError(null);
    setBusy(true);
    atBottomRef.current = true;

    setConversations((prev) =>
      prev.map((c) =>
        c.id === convoId
          ? {
              ...c,
              messages: [...transcript, { role: 'assistant', content: '', ts: Date.now() }],
              title: c.messages.some((m) => m.content.trim().length > 0) ? c.title : deriveTitle(transcript),
              updatedAt: Date.now(),
            }
          : c,
      ),
    );

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

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      // Send the full running transcript so the agent keeps context across turns.
      await sendChatStream(transcript, 'foundry', appendToAssistant, controller.signal);
    } catch (err) {
      const aborted = controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError');
      // Drop an assistant bubble that never received any text.
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== convoId) return c;
          const msgs = c.messages.slice();
          const last = msgs[msgs.length - 1];
          if (last && last.role === 'assistant' && last.content === '') msgs.pop();
          return { ...c, messages: msgs };
        }),
      );
      if (!aborted) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
        retryRef.current = { convoId, transcript };
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }, []);

  function doSend(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy || !active) return;
    // Drop empty-content messages (e.g. a placeholder left by a turn that streamed
    // nothing); the API requires content.min(1) so re-sending one 400s the turn.
    const priorMsgs = active.messages.filter((m) => m.content.trim().length > 0);
    const transcript: StoredTurn[] = [...priorMsgs, { role: 'user', content: trimmed, ts: Date.now() }];
    resetComposer();
    void runTurn(active.id, transcript);
  }

  function onComposerSubmit(e: React.FormEvent) {
    e.preventDefault();
    doSend(input);
  }

  function onComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter inserts a newline. Ignore Enter mid-IME-composition.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      doSend(input);
    }
  }

  function stopGenerating() {
    abortRef.current?.abort();
  }

  function retry() {
    const r = retryRef.current;
    if (r) void runTurn(r.convoId, r.transcript);
  }

  // Re-run the last user turn from scratch, discarding the assistant reply that
  // followed it. Useful when an answer streamed fine but wasn't useful.
  function regenerate() {
    if (!active || busy) return;
    const msgs = active.messages;
    const lastUserIdx = [...msgs].map((m) => m.role).lastIndexOf('user');
    if (lastUserIdx === -1) return;
    const transcript = msgs.slice(0, lastUserIdx + 1) as StoredTurn[];
    void runTurn(active.id, transcript);
  }

  // Pull the last prompt back into the composer for editing and drop it (plus
  // its reply) from the transcript so resending doesn't duplicate it.
  function editLastUser() {
    if (!active || busy) return;
    const msgs = active.messages;
    const lastUserIdx = [...msgs].map((m) => m.role).lastIndexOf('user');
    if (lastUserIdx === -1) return;
    const text = msgs[lastUserIdx].content;
    setConversations((prev) =>
      prev.map((c) => (c.id === active.id ? { ...c, messages: c.messages.slice(0, lastUserIdx) } : c)),
    );
    setInput(text);
    requestAnimationFrame(() => {
      taRef.current?.focus();
      autoGrow(taRef.current);
    });
  }

  async function copyMessage(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
    } catch {
      /* clipboard unavailable / blocked */
    }
  }

  const messages = active?.messages ?? [];
  const lastMsg = messages[messages.length - 1];
  const lastIsEmptyAssistant = !!lastMsg && lastMsg.role === 'assistant' && lastMsg.content === '';
  const isEmptyChat = messages.every((m) => m.content.trim().length === 0);
  const lastUserIndex = [...messages].map((m) => m.role).lastIndexOf('user');
  const lastAssistantIndex = messages.reduce(
    (found, m, i) => (m.role === 'assistant' && m.content ? i : found),
    -1,
  );
  // The orchestrator always ends a draft turn by asking the user to confirm before
  // it will submit anything for approval. Detect that so we can offer a one-click
  // "Confirm & submit" button instead of requiring the user to type it out.
  const awaitingConfirmation =
    !busy && lastAssistantIndex === messages.length - 1 && /confirm/i.test(messages[lastAssistantIndex]?.content ?? '');

  if (!open) {
    return (
      <button className="chat-fab" onClick={() => setOpen(true)} aria-label="Open assistant" title="Open assistant (Ctrl+/)">
        <ChatBubbleIcon /> Assistant
      </button>
    );
  }

  return (
    <div className={`chat-panel ${maximized ? 'maximized' : ''}`} role="dialog" aria-label="Multi-Agent Sales Assistant">
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
          <div className="chat-rail-search">
            <input
              type="search"
              value={railSearch}
              onChange={(e) => setRailSearch(e.target.value)}
              placeholder="Search chats…"
              aria-label="Search chat history"
            />
          </div>
          <div className="chat-rail-list">
            {filteredChats.map((c) => (
              <button
                key={c.id}
                className={`chat-rail-item ${c.id === active?.id ? 'active' : ''}`}
                onClick={() => selectChat(c.id)}
                title={c.title}
              >
                <svg className="rail-ico" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5z" />
                </svg>
                <span className="rail-title-col">
                  <span className="rail-title">{c.title}</span>
                  <span className="rail-time">{formatRelative(c.updatedAt)}</span>
                </span>
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
            {filteredChats.length === 0 && (
              <p className="muted" style={{ padding: '0 12px', fontSize: 12.5 }}>No chats match "{railSearch}".</p>
            )}
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
              <span className="badge chat-engine-badge" title="Answers are generated by the deployed Foundry hosted agent">
                {ENGINE_LABELS.foundry}
              </span>
            </div>
            <div>
              <button
                className="icon-btn"
                aria-label={maximized ? 'Restore panel size' : 'Maximize panel'}
                title={maximized ? 'Restore panel size' : 'Maximize panel'}
                onClick={() => setMaximized((v) => !v)}
              >
                {maximized ? <CollapseIcon /> : <ExpandIcon />}
              </button>
              <button className="icon-btn" aria-label="New chat" title="Start a new chat" onClick={newChat}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
              <button className="icon-btn" aria-label="Close" title="Close (Ctrl+/)" onClick={() => setOpen(false)}>
                ×
              </button>
            </div>
          </div>

          <div className="chat-messages" ref={listRef} onScroll={onListScroll} role="log" aria-live="polite" aria-label="Conversation">
            <div className="chat-row assistant">
              <AssistantAvatar />
              <div className="chat-col">
                <div className="chat-msg assistant">
                  <Markdown text={WELCOME_TEXT} />
                </div>
              </div>
            </div>

            {isEmptyChat && (
              <div className="chat-suggests">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" className="chat-suggest" onClick={() => doSend(s)} disabled={busy}>
                    {s}
                  </button>
                ))}
              </div>
            )}

            {messages.map((m, i) => {
              if (m.role === 'assistant' && m.content === '') return null;
              const key = `${active?.id ?? 'c'}:${i}`;
              const streaming = busy && i === messages.length - 1 && m.role === 'assistant';
              return (
                <div key={key} className={`chat-row ${m.role}`}>
                  {m.role === 'assistant' ? <AssistantAvatar /> : <UserAvatar />}
                  <div className="chat-col">
                    <div className={`chat-msg ${m.role}${streaming ? ' streaming' : ''}`}>
                      {m.role === 'assistant' ? <Markdown text={m.content} /> : m.content}
                    </div>
                    <div className="chat-meta">
                      {m.ts ? <span className="chat-time">{formatTime(m.ts)}</span> : null}
                      {m.role === 'assistant' && m.content ? (
                        <button
                          type="button"
                          className="chat-copy"
                          onClick={() => copyMessage(key, m.content)}
                          title="Copy message"
                          aria-label="Copy message"
                        >
                          {copiedKey === key ? <CheckIcon /> : <CopyIcon />}
                          {copiedKey === key ? 'Copied' : 'Copy'}
                        </button>
                      ) : null}
                      {m.role === 'assistant' && i === lastAssistantIndex && !busy ? (
                        <button
                          type="button"
                          className="chat-copy"
                          onClick={regenerate}
                          title="Regenerate this response"
                          aria-label="Regenerate this response"
                        >
                          <RegenerateIcon /> Regenerate
                        </button>
                      ) : null}
                      {m.role === 'user' && i === lastUserIndex && !busy ? (
                        <button
                          type="button"
                          className="chat-copy"
                          onClick={editLastUser}
                          title="Edit and resend this message"
                          aria-label="Edit and resend this message"
                        >
                          <EditIcon /> Edit
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}

            {busy && lastIsEmptyAssistant && (
              <div className="chat-row assistant">
                <AssistantAvatar />
                <div className="chat-col">
                  <div className="chat-msg assistant chat-typing" aria-label="Assistant is typing">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              </div>
            )}

            {awaitingConfirmation && (
              <div className="chat-suggests chat-suggests-confirm">
                <button type="button" className="chat-suggest chat-suggest-confirm" onClick={() => doSend('Confirm. Submit for approval.')}>
                  <CheckIcon /> Confirm &amp; submit for approval
                </button>
              </div>
            )}

            {error && (
              <div className="chat-errbar" role="alert">
                <span>{error}</span>
                {retryRef.current && (
                  <button type="button" className="chat-retry" onClick={retry}>
                    Retry
                  </button>
                )}
              </div>
            )}
          </div>

          {showJump && (
            <button type="button" className="chat-jump" onClick={() => scrollToBottom()} aria-label="Jump to latest message">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 5v14M19 12l-7 7-7-7" />
              </svg>
              Latest
            </button>
          )}

          <form className="chat-input" onSubmit={onComposerSubmit}>
            <div className="chat-input-box">
              <textarea
                ref={taRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  autoGrow(e.target);
                }}
                onKeyDown={onComposerKeyDown}
                placeholder="Ask about milestones, opportunities, metrics…"
                rows={1}
                aria-label="Message the assistant"
                autoFocus
              />
              {busy ? (
                <button type="button" className="chat-send stop" onClick={stopGenerating} aria-label="Stop generating" title="Stop generating">
                  <StopIcon />
                </button>
              ) : (
                <button type="submit" className="chat-send" disabled={!input.trim()} aria-label="Send message" title="Send">
                  <SendIcon />
                </button>
              )}
            </div>
            <div className="chat-hint">Enter to send · Shift+Enter for a new line</div>
          </form>
        </div>
      </div>
    </div>
  );
}
