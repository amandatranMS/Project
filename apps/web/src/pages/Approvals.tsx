import { useEffect, useState } from 'react';
import { choiceLabel } from '@msx/shared';
import { api, type ApprovalRequest } from '../api/client';
import { statusBadgeClass } from '../ui';

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
      const created = await api.post<{ milestoneBusinessId: string; milestoneName: string }>(
        `/agent/approvals/${id}/fulfill`,
        { agentName: 'MilestoneAdvisor' },
      );
      setMessage(`Milestone created after approval: ${created.milestoneBusinessId} — ${created.milestoneName}`);
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
            <th>ID</th>
            <th>Request</th>
            <th>Opportunity</th>
            <th>Requested By</th>
            <th>Approval</th>
            <th>Writeback</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((a) => (
            <tr key={a.id}>
              <td>{a.approvalRequestBusinessId}</td>
              <td>{a.requestName ?? '—'}</td>
              <td>{a.opportunity?.opportunityName ?? '—'}</td>
              <td>{a.requestedBy ?? '—'}</td>
              <td><span className={`badge ${statusBadgeClass(a.approvalStatus)}`}>{choiceLabel(a.approvalStatus)}</span></td>
              <td>{a.mockWritebackStatus ?? '—'}</td>
              <td>
                <div className="btn-row">
                  {a.approvalStatus === 'Pending' && (
                    <>
                      <button disabled={busyId === a.id} onClick={() => decide(a.id, 'Approved')}>Approve</button>
                      <button className="danger" disabled={busyId === a.id} onClick={() => decide(a.id, 'Rejected')}>Reject</button>
                    </>
                  )}
                  {a.approvalStatus === 'Approved' && a.mockWritebackStatus !== 'Completed' && (
                    <button className="secondary" disabled={busyId === a.id} onClick={() => fulfill(a.id)}>
                      Create milestone
                    </button>
                  )}
                  {a.approvalStatus === 'Rejected' && <span className="muted">Rejected</span>}
                  {a.mockWritebackStatus === 'Completed' && <span className="muted">Fulfilled</span>}
                </div>
              </td>
            </tr>
          ))}
          {items.length === 0 && !error && (
            <tr><td colSpan={7} className="muted">No approval requests.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
