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
      .get<ApprovalRequest[]>('/approval-requests')
      .then(setItems)
      .catch((e) => setError(e.message));
  }

  useEffect(load, []);

  async function decide(id: string, action: 'approve' | 'reject' | 'needs-changes') {
    setBusyId(id);
    setMessage(null);
    try {
      const result = await api.patch<{
        milestone?: { milestoneBusinessId: string; milestoneName: string };
        action?: string;
      }>(`/approval-requests/${id}/${action}`, { reviewedBy: 'Demo Approver' });
      if (action === 'approve') {
        if (result?.milestone) {
          setMessage(`Approved — milestone created: ${result.milestone.milestoneBusinessId} — ${result.milestone.milestoneName}`);
        } else if (result?.action) {
          setMessage(`Approved — action executed: ${result.action} (simulated where applicable, recorded in the audit log).`);
        } else {
          setMessage('Approved.');
        }
      }
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
        Human-in-the-loop gate. The agent only submits requests — approving one here executes the
        action (create milestone, update/delete milestone, send email, or post Teams) and records it
        in the audit log. Nothing the agent proposes happens until a human approves.
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
                  {(a.approvalStatus === 'Pending' || a.approvalStatus === 'Needs Changes') && (
                    <>
                      <button disabled={busyId === a.id} onClick={() => decide(a.id, 'approve')}>Approve</button>
                      <button className="danger" disabled={busyId === a.id} onClick={() => decide(a.id, 'reject')}>Reject</button>
                      <button className="secondary" disabled={busyId === a.id} onClick={() => decide(a.id, 'needs-changes')}>Needs changes</button>
                    </>
                  )}
                  {a.approvalStatus === 'Approved' && <span className="muted">Executed</span>}
                  {a.approvalStatus === 'Rejected' && <span className="muted">Rejected</span>}
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
