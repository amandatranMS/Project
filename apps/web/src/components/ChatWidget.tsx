import { useEffect, useRef, useState } from 'react';
import { sendChat, type ChatEngine, type ChatTurn } from '../api/client';

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

// Persist the transcript so it survives closing the widget, navigating between
// pages (which remounts this component), and full page reloads. Without this the
// conversation vanishes and the agent loses context, causing it to re-ask.
const TRANSCRIPT_KEY = 'msx-chat-transcript';
const ENGINE_KEY = 'msx-chat-engine';

/** Loads the saved transcript (real user/assistant turns; the welcome is separate). */
function loadTranscript(): ChatTurn[] {
  try {
    const raw = localStorage.getItem(TRANSCRIPT_KEY);
    const parsed = raw ? (JSON.parse(raw) as ChatTurn[]) : null;
    if (Array.isArray(parsed)) return parsed;
  } catch {
    /* ignore corrupt storage */
  }
  return [];
}

function loadEngine(): ChatEngine {
  const v = localStorage.getItem(ENGINE_KEY);
  return v === 'foundry' || v === 'in-app' ? v : 'in-app';
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [engine, setEngine] = useState<ChatEngine>(loadEngine);
  const [messages, setMessages] = useState<ChatTurn[]>(loadTranscript);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy, open]);

  // Persist the transcript and engine choice whenever they change.
  useEffect(() => {
    try {
      localStorage.setItem(TRANSCRIPT_KEY, JSON.stringify(messages));
    } catch {
      /* storage may be unavailable (private mode, quota) */
    }
  }, [messages]);
  useEffect(() => {
    try {
      localStorage.setItem(ENGINE_KEY, engine);
    } catch {
      /* ignore */
    }
  }, [engine]);

  function clearChat() {
    setMessages([]);
    setError(null);
    try {
      localStorage.removeItem(TRANSCRIPT_KEY);
    } catch {
      /* ignore */
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;

    const next: ChatTurn[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setError(null);
    setBusy(true);
    try {
      // Send the full running transcript so the agent keeps context across turns.
      const { reply } = await sendChat(next, engine);
      setMessages((cur) => [...cur, { role: 'assistant', content: reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="chat-fab" onClick={() => setOpen(true)} aria-label="Open assistant">
        💬 Assistant
      </button>
    );
  }

  return (
    <div className="chat-panel" role="dialog" aria-label="MSX Milestone Assistant">
      <div className="chat-header">
        <div>
          <strong>Assistant</strong>
          <select
            className="chat-engine"
            value={engine}
            onChange={(e) => setEngine(e.target.value as ChatEngine)}
            title="Which engine answers your messages"
          >
            <option value="in-app">{ENGINE_LABELS['in-app']}</option>
            <option value="foundry">{ENGINE_LABELS.foundry}</option>
          </select>
        </div>
        <button className="icon-btn" aria-label="New chat" title="Start a new chat" onClick={clearChat}>
          ⟲
        </button>
        <button className="icon-btn" aria-label="Close" onClick={() => setOpen(false)}>
          ×
        </button>
      </div>

      <div className="chat-messages" ref={listRef}>
        <div className="chat-msg assistant">{WELCOME.content}</div>
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            {m.content}
          </div>
        ))}
        {busy && <div className="chat-msg assistant muted">Thinking…</div>}
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
  );
}
