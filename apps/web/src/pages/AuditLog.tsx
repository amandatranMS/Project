import { useEffect, useMemo, useState } from 'react';
import { api, type AuditLog as AuditLogEntry } from '../api/client';
import { statusBadgeClass, formatDate } from '../ui';

interface ConversationTurn {
  role: string;
  content: string;
}

/** Safely parse the stored conversation JSON into displayable turns. */
function parseConversation(raw?: string | null): ConversationTurn[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ConversationTurn[];
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch {
    /* not valid JSON */
  }
  return null;
}

export default function AuditLog() {
  const [items, setItems] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AuditLogEntry | null>(null);
  // API already returns newest-first; default to that and let the user flip it.
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

  useEffect(() => {
    api
      .get<AuditLogEntry[]>('/agent-action-audit-logs')
      .then(setItems)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const sortedItems = useMemo(() => {
    const withTime = items.map((item) => ({
      item,
      time: new Date(item.timestamp ?? item.createdAt).getTime(),
    }));
    withTime.sort((a, b) => (sortOrder === 'desc' ? b.time - a.time : a.time - b.time));
    return withTime.map((w) => w.item);
  }, [items, sortOrder]);

  const conversation = parseConversation(selected?.conversation);

  return (
    <div>
      <div className="page-header">
        <h1>Agent Action Audit Log</h1>
      </div>
      <p className="muted">
        Every agent action is recorded here for governance and auditability. Select a row to review the
        action and the conversation (prompts &amp; answers) that produced it.
      </p>
      {error && <p className="error">{error}</p>}
      <div className="row" style={{ marginBottom: 'var(--sp-3)' }}>
        <label className="muted" htmlFor="audit-sort" style={{ fontSize: 13 }}>Sort by time</label>
        <select id="audit-sort" value={sortOrder} onChange={(e) => setSortOrder(e.target.value as 'desc' | 'asc')}>
          <option value="desc">Latest first</option>
          <option value="asc">Earliest first</option>
        </select>
      </div>
      <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>When</th>
            <th>Agent</th>
            <th>Action</th>
            <th>Type</th>
            <th>Result</th>
            <th>Summary</th>
            <th>Conversation</th>
          </tr>
        </thead>
        <tbody>
          {loading &&
            Array.from({ length: 6 }).map((_, i) => (
              <tr key={`sk-${i}`} className="skeleton-row">
                <td colSpan={8}>
                  <span className="skeleton-line" />
                </td>
              </tr>
            ))}
          {!loading && sortedItems.map((l) => {
            const hasConvo = Boolean(parseConversation(l.conversation));
            return (
              <tr key={l.id} className="clickable" onClick={() => setSelected(l)}>
                <td>{l.auditBusinessId}</td>
                <td>{formatDate(l.timestamp ?? l.createdAt)}</td>
                <td>{l.agentName ?? '—'}</td>
                <td>{l.actionName ?? '—'}</td>
                <td>{l.actionType ?? '—'}</td>
                <td><span className={`badge ${statusBadgeClass(l.result)}`}>{l.result ?? '—'}</span></td>
                <td className="muted">{l.outputSummary ?? '—'}</td>
                <td>{hasConvo ? <span className="badge blue">View</span> : <span className="muted">—</span>}</td>
              </tr>
            );
          })}
          {!loading && items.length === 0 && !error && (
            <tr><td colSpan={8} className="muted">No agent actions recorded yet.</td></tr>
          )}
        </tbody>
      </table>
      </div>

      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{selected.actionName ?? selected.actionType ?? 'Audit entry'}</h2>
              <button className="icon-btn" aria-label="Close" onClick={() => setSelected(null)}>×</button>
            </div>
            <div className="modal-body stack">
              <div className="audit-meta">
                <div><span className="k">Audit ID</span><span>{selected.auditBusinessId}</span></div>
                <div><span className="k">When</span><span>{formatDate(selected.timestamp ?? selected.createdAt)}</span></div>
                <div><span className="k">Agent</span><span>{selected.agentName ?? '—'}</span></div>
                <div><span className="k">Type</span><span>{selected.actionType ?? '—'}</span></div>
                <div><span className="k">Result</span><span className={`badge ${statusBadgeClass(selected.result)}`}>{selected.result ?? '—'}</span></div>
                <div><span className="k">Actor</span><span>{selected.actor ?? '—'}</span></div>
              </div>
              {selected.inputSummary && <p className="muted" style={{ margin: 0 }}>Input: {selected.inputSummary}</p>}
              {selected.outputSummary && <p className="muted" style={{ margin: 0 }}>Output: {selected.outputSummary}</p>}

              <h2 style={{ marginTop: 8 }}>Conversation</h2>
              {conversation ? (
                <div className="audit-convo">
                  {conversation.map((m, i) => (
                    <div key={i} className={`chat-msg ${m.role === 'user' ? 'user' : 'assistant'}`}>
                      {m.content}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">
                  No conversation was captured for this action (it came from a direct UI or API action,
                  not the assistant).
                </p>
              )}
            </div>
            <div className="modal-footer">
              <button className="secondary" onClick={() => setSelected(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
