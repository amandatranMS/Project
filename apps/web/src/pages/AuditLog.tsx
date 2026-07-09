import { useEffect, useState } from 'react';
import { api, type AuditLog as AuditLogEntry } from '../api/client';
import { statusBadgeClass, formatDate } from '../ui';

export default function AuditLog() {
  const [items, setItems] = useState<AuditLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<AuditLogEntry[]>('/agent/audit')
      .then(setItems)
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <div className="page-header">
        <h1>Agent Action Audit Log</h1>
      </div>
      <p className="muted">Every agent action is recorded here for governance and auditability.</p>
      {error && <p className="error">{error}</p>}
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
          </tr>
        </thead>
        <tbody>
          {items.map((l) => (
            <tr key={l.id}>
              <td>{l.auditBusinessId}</td>
              <td>{formatDate(l.timestamp ?? l.createdAt)}</td>
              <td>{l.agentName ?? '—'}</td>
              <td>{l.actionName ?? '—'}</td>
              <td>{l.actionType ?? '—'}</td>
              <td><span className={`badge ${statusBadgeClass(l.result)}`}>{l.result ?? '—'}</span></td>
              <td className="muted">{l.outputSummary ?? '—'}</td>
            </tr>
          ))}
          {items.length === 0 && !error && (
            <tr><td colSpan={7} className="muted">No agent actions recorded yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
