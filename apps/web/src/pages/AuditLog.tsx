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
            <th>When</th>
            <th>Agent</th>
            <th>Action</th>
            <th>Entity</th>
            <th>Outcome</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {items.map((l) => (
            <tr key={l.id}>
              <td>{formatDate(l.performedAt)}</td>
              <td>{l.agentName}</td>
              <td>{l.actionType}</td>
              <td>{l.entityType ? `${l.entityType}` : '—'}</td>
              <td><span className={`badge ${statusBadgeClass(l.outcome === 'Blocked' ? 'Rejected' : l.outcome === 'Success' ? 'Approved' : 'Failed')}`}>{l.outcome}</span></td>
              <td className="muted">{l.notes ?? '—'}</td>
            </tr>
          ))}
          {items.length === 0 && !error && (
            <tr><td colSpan={6} className="muted">No agent actions recorded yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
