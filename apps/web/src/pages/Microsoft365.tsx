import { useRef, useState } from 'react';
import { useMsal } from '@azure/msal-react';
import { graphConsentRequest } from '../auth/msalConfig';
import { api } from '../api/client';

/**
 * A friendly surface for the real Microsoft Graph integration (Option B).
 * Everything here runs AS the signed-in user (on-behalf-of) — no agent, no
 * admin, no Copilot. Reads render as cards/lists; a "Show raw JSON" toggle keeps
 * the developer view one click away.
 */

// ---- Graph response shapes (mirror apps/api/src/services/graph.service.ts) ----
interface GraphUser {
  id: string;
  displayName?: string;
  mail?: string;
  userPrincipalName?: string;
  jobTitle?: string;
  department?: string;
}
interface GraphMessage {
  id: string;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime?: string;
  webLink?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
}
interface GraphChat {
  id: string;
  topic?: string | null;
  chatType?: string;
  lastUpdatedDateTime?: string;
}
interface TeamsChatMessage {
  from: string;
  sentAt?: string;
  text: string;
}
interface TeamsChatThread {
  id: string;
  topic: string | null;
  chatType?: string;
  lastUpdatedDateTime?: string;
  messages: TeamsChatMessage[];
}
interface Hierarchy {
  me: GraphUser;
  manager: GraphUser | null;
  directReports: GraphUser[];
  colleagues: GraphUser[];
}
type ResultKind = 'profile' | 'hierarchy' | 'email' | 'chats' | 'teamsMessages';
interface ResultState {
  kind: ResultKind;
  label: string;
  data: unknown;
}

const initials = (name?: string) =>
  (name ?? '?')
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?';

const fmtDate = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
};

export default function Microsoft365() {
  const { instance, accounts } = useMsal();
  const [busy, setBusy] = useState<string | null>(null); // label of the running action
  const [result, setResult] = useState<ResultState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);

  const scrollToResult = () =>
    requestAnimationFrame(() =>
      resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );

  const run = async (kind: ResultKind, label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    setResult(null);
    setShowRaw(false);
    scrollToResult();
    try {
      const data = await fn();
      setResult({ kind, label, data });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
      scrollToResult();
    }
  };

  const connect = () => {
    // Full-page redirect (not popup): reliable in embedded/popup-blocked
    // browsers. Returns to the app after consent; main.tsx handles the redirect.
    // prompt:'consent' forces a fresh consent + token so newly granted scopes
    // (e.g. Chat.ReadWrite for Teams) are picked up instead of a cached token.
    setError(null);
    setResult(null);
    void instance.acquireTokenRedirect({
      ...graphConsentRequest,
      account: accounts[0],
      prompt: 'consent',
    });
  };

  const anyBusy = busy !== null;
  const label = (text: string) => (busy === text ? 'Loading…' : text);

  const renderResult = () => {
    if (anyBusy) {
      return (
        <div className="m365-loading">
          <span className="m365-spinner" aria-hidden="true" />
          {busy}…
        </div>
      );
    }
    if (error) return <div className="m365-status error">✗ {error}</div>;
    if (!result) return <p className="muted m365-empty">Run an action above and the result appears here.</p>;
    if (showRaw) return <pre className="m365-output">{JSON.stringify(result.data, null, 2)}</pre>;
    switch (result.kind) {
      case 'profile':
        return <ProfileCard user={result.data as GraphUser} />;
      case 'hierarchy':
        return <HierarchyView h={result.data as Hierarchy} />;
      case 'email':
        return <EmailList messages={result.data as GraphMessage[]} />;
      case 'chats':
        return <ChatList chats={result.data as GraphChat[]} />;
      case 'teamsMessages':
        return <TeamsMessagesView threads={result.data as TeamsChatThread[]} />;
      default:
        return <pre className="m365-output">{JSON.stringify(result.data, null, 2)}</pre>;
    }
  };

  return (
    <div className="m365-page">
      <h2>Microsoft 365 (acts as you)</h2>
      <p className="muted">
        Real Microsoft Graph, on your behalf. Reads use your login; the org chart also
        needs a one-time admin consent. Sending is gated: Preview first, then Send. Email
        and Teams run in <strong>simulate</strong> mode by default (recorded &amp; audited,
        not delivered) — switch to live delivery later once an admin consents.
      </p>

      <section className="m365-section">
        <h3>1 · Consent</h3>
        <button className="btn" disabled={anyBusy} onClick={connect}>
          Connect Microsoft 365
        </button>
      </section>

      <section className="m365-section">
        <h3>2 · Read</h3>
        <div className="m365-actions">
          <button className="btn" disabled={anyBusy} onClick={() => run('profile', 'My profile', () => api.get('/graph/me'))}>
            {label('My profile')}
          </button>
          <button className="btn" disabled={anyBusy} onClick={() => run('hierarchy', 'Manager & coworkers', () => api.get('/graph/hierarchy'))}>
            {label('Manager & coworkers')}
          </button>
          <button className="btn" disabled={anyBusy} onClick={() => run('email', 'Recent email', () => api.get('/graph/outlook/messages?top=5'))}>
            {label('Recent email')}
          </button>
          <button className="btn" disabled={anyBusy} onClick={() => run('chats', 'Recent Teams chats', () => api.get('/graph/teams/chats?top=5'))}>
            {label('Recent Teams chats')}
          </button>
          <button className="btn" disabled={anyBusy} onClick={() => run('teamsMessages', 'Recent Teams messages', () => api.get('/graph/teams/messages?top=5&perChat=5'))}>
            {label('Recent Teams messages')}
          </button>
        </div>
      </section>

      <section className="m365-section" ref={resultRef}>
        <div className="m365-result-head">
          <h3>Result{result ? ` · ${result.label}` : ''}</h3>
          {result && !anyBusy && (
            <button className="m365-toggle" onClick={() => setShowRaw((v) => !v)}>
              {showRaw ? 'Show friendly view' : 'Show raw JSON'}
            </button>
          )}
        </div>
        {renderResult()}
      </section>
    </div>
  );
}

/** A compact person row (avatar + name + title/email). */
function PersonRow({ u }: { u: GraphUser }) {
  return (
    <div className="m365-person">
      <span className="m365-avatar sm">{initials(u.displayName)}</span>
      <div>
        <div className="m365-person-name">{u.displayName ?? u.userPrincipalName ?? '(unknown)'}</div>
        <div className="m365-person-sub">{[u.jobTitle, u.mail ?? u.userPrincipalName].filter(Boolean).join(' · ')}</div>
      </div>
    </div>
  );
}

function ProfileCard({ user }: { user: GraphUser }) {
  return (
    <>
      <div className="m365-status success">✓ Connected — this is your signed-in Microsoft account.</div>
      <div className="m365-person m365-person-lg">
        <span className="m365-avatar">{initials(user.displayName)}</span>
        <div>
          <div className="m365-person-name">{user.displayName ?? '(no name)'}</div>
          <div className="m365-person-sub">{user.mail ?? user.userPrincipalName}</div>
          {(user.jobTitle || user.department) && (
            <div className="m365-person-meta">{[user.jobTitle, user.department].filter(Boolean).join(' · ')}</div>
          )}
        </div>
      </div>
    </>
  );
}

function HierarchyView({ h }: { h: Hierarchy }) {
  return (
    <>
      <div className="m365-subhead">Manager</div>
      {h.manager ? <PersonRow u={h.manager} /> : <p className="muted">No manager on record.</p>}

      <div className="m365-subhead">Direct reports ({h.directReports.length})</div>
      {h.directReports.length ? (
        h.directReports.map((u) => <PersonRow key={u.id} u={u} />)
      ) : (
        <p className="muted">None.</p>
      )}

      <div className="m365-subhead">Colleagues ({h.colleagues.length})</div>
      {h.colleagues.length ? (
        h.colleagues.map((u) => <PersonRow key={u.id} u={u} />)
      ) : (
        <p className="muted">None.</p>
      )}
    </>
  );
}

function EmailList({ messages }: { messages: GraphMessage[] }) {
  if (!messages.length) return <p className="muted">No recent messages.</p>;
  return (
    <ul className="m365-list">
      {messages.map((m) => (
        <li key={m.id} className="m365-item">
          <div className="m365-item-top">
            <span className="m365-item-title">{m.subject || '(no subject)'}</span>
            <span className="m365-item-date">{fmtDate(m.receivedDateTime)}</span>
          </div>
          <div className="m365-item-sub">
            From: {m.from?.emailAddress?.name ?? m.from?.emailAddress?.address ?? 'unknown'}
          </div>
          {m.bodyPreview && <div className="m365-item-preview">{m.bodyPreview}</div>}
          {m.webLink && (
            <a className="m365-link" href={m.webLink} target="_blank" rel="noreferrer">
              Open in Outlook →
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

function ChatList({ chats }: { chats: GraphChat[] }) {
  if (!chats.length) return <p className="muted">No recent chats.</p>;
  const chatTitle = (c: GraphChat) =>
    c.topic ||
    (c.chatType === 'oneOnOne' ? 'One-on-one chat' : c.chatType === 'group' ? 'Group chat' : 'Chat');
  return (
    <ul className="m365-list">
      {chats.map((c) => (
        <li key={c.id} className="m365-item">
          <div className="m365-item-top">
            <span className="m365-item-title">{chatTitle(c)}</span>
            <span className="m365-item-date">{fmtDate(c.lastUpdatedDateTime)}</span>
          </div>
          {c.chatType && <div className="m365-item-sub">{c.chatType}</div>}
        </li>
      ))}
    </ul>
  );
}

function TeamsMessagesView({ threads }: { threads: TeamsChatThread[] }) {
  if (!threads.length) return <p className="muted">No recent chats.</p>;
  const threadTitle = (t: TeamsChatThread) =>
    t.topic ||
    (t.chatType === 'oneOnOne' ? 'One-on-one chat' : t.chatType === 'group' ? 'Group chat' : 'Chat');
  return (
    <ul className="m365-list">
      {threads.map((t) => (
        <li key={t.id} className="m365-item">
          <div className="m365-item-top">
            <span className="m365-item-title">{threadTitle(t)}</span>
            <span className="m365-item-date">{fmtDate(t.lastUpdatedDateTime)}</span>
          </div>
          {t.messages.length ? (
            <div className="m365-thread">
              {t.messages.map((m, i) => (
                <div key={i} className="m365-msg">
                  <div className="m365-msg-head">
                    <span className="m365-msg-from">{m.from}</span>
                    <span className="m365-item-date">{fmtDate(m.sentAt)}</span>
                  </div>
                  <div className="m365-item-preview">{m.text}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="m365-item-sub muted">No readable messages in this chat.</div>
          )}
        </li>
      ))}
    </ul>
  );
}
