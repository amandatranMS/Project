import { useEffect, useState } from 'react';
import { api, type ApprovalRequest } from '../api/client';
import { statusBadgeClass, formatDate } from '../ui';

export default function Approvals() {
  const [items, setItems] = useState<ApprovalRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function load() {
    api
      .get<ApprovalRequest[]>('/agent/approvals')
      .then(setItems)
      .catch((e) => setError(e.message));
  }

  useEffect(load, []);

  async function decide(id: string, decision: 'Approved' | 'Rejected') {
    setBusyId(id);
    setMessage(null);
    try {
      await api.post(`/agent/approvals/${id}/decision`, { decision, reviewedBy: 'Demo Approver' });
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function fulfill(id: string) {
    setBusyId(id);
    setMessage(null);
    try {
      const created = await api.post<{ id: string; title: string }>(`/agent/approvals/${id}/fulfill`, { agentName: 'MilestoneAdvisor' });
      setMessage(`Milestone created after approval: ${created.title}`);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Approval Requests</h1>
      </div>
      <p className="muted">
        Human-in-the-loop gate. Agents can only create real milestone records after an approval is granted here.
      </p>
      {error && <p className="error">{error}</p>}
      {message && <p style={{ color: 'var(--success)' }}>{message}</p>}
      <table>
        <thead>
          <tr>
            <th>Summary</th>
            <th>Type</th>
            <th>Requested By</th>
            <th>Created</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((a) => (
            <tr key={a.id}>
              <td>{a.summary}</td>
              <td>{a.requestType}</td>
              <td>{a.requestedBy}</td>
              <td>{formatDate(a.createdAt)}</td>
              <td><span className={`badge ${statusBadgeClass(a.status)}`}>{a.status}</span></td>
              <td>
                <div className="btn-row">
                  {a.status === 'Pending' && (
                    <>
                      <button disabled={busyId === a.id} onClick={() => decide(a.id, 'Approved')}>Approve</button>
                      <button className="danger" disabled={busyId === a.id} onClick={() => decide(a.id, 'Rejected')}>Reject</button>
                    </>
                  )}
                  {a.status === 'Approved' && a.requestType === 'Create Milestone' && (
                    <button className="secondary" disabled={busyId === a.id} onClick={() => fulfill(a.id)}>
                      Create milestone
                    </button>
                  )}
                  {a.status === 'Rejected' && <span className="muted">Rejected</span>}
                </div>
              </td>
            </tr>
          ))}
          {items.length === 0 && !error && (
            <tr><td colSpan={6} className="muted">No approval requests.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
