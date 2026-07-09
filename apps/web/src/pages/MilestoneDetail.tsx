import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, type Milestone, type Recommendation, type ApprovalRequest } from '../api/client';
import { statusBadgeClass, formatDate } from '../ui';

interface MilestoneDetailData extends Milestone {
  statusHistory: { id: string; previousStatus?: string | null; newStatus: string; changedBy: string; changeReason?: string | null; changedAt: string }[];
  recommendations: Recommendation[];
  approvalRequests: ApprovalRequest[];
  collaborationNotes: { id: string; authorName: string; noteText: string }[];
}

const STATUSES = ['Not Started', 'In Progress', 'Blocked', 'At Risk', 'Completed', 'Cancelled'];

export default function MilestoneDetail() {
  const { id } = useParams();
  const [data, setData] = useState<MilestoneDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    if (!id) return;
    api
      .get<MilestoneDetailData>(`/milestones/${id}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }

  useEffect(load, [id]);

  async function changeStatus(newStatus: string) {
    if (!id) return;
    setBusy(true);
    try {
      await api.post(`/milestones/${id}/status`, { newStatus, changedBy: 'Demo User', changeReason: 'Manual update from UI' });
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;

  return (
    <div className="stack">
      <div className="page-header">
        <h1>{data.title}</h1>
        <span className={`badge ${statusBadgeClass(data.status)}`}>{data.status}</span>
      </div>

      <div className="card">
        <div className="grid cols-3">
          <div><div className="muted">Type</div>{data.milestoneType}</div>
          <div><div className="muted">Priority</div>{data.priority}</div>
          <div><div className="muted">Owner</div>{data.owner}</div>
          <div><div className="muted">Due</div>{formatDate(data.dueDate)}</div>
          <div><div className="muted">Blocker</div>{data.blockerStatus}</div>
          <div><div className="muted">Risk Score</div>{data.riskScore}</div>
        </div>
        {data.description && <p className="section">{data.description}</p>}
        {data.blockerDescription && <p className="muted">Blocker: {data.blockerDescription}</p>}
        {data.riskAssessment && <p className="muted">Risk: {data.riskAssessment}</p>}
      </div>

      <div className="card">
        <h2>Change status</h2>
        <div className="btn-row">
          {STATUSES.map((s) => (
            <button key={s} className="secondary" disabled={busy || s === data.status} onClick={() => changeStatus(s)}>
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Status history</h2>
        <table>
          <thead>
            <tr><th>When</th><th>From</th><th>To</th><th>By</th><th>Reason</th></tr>
          </thead>
          <tbody>
            {data.statusHistory.map((h) => (
              <tr key={h.id}>
                <td>{formatDate(h.changedAt)}</td>
                <td>{h.previousStatus ?? '—'}</td>
                <td><span className={`badge ${statusBadgeClass(h.newStatus)}`}>{h.newStatus}</span></td>
                <td>{h.changedBy}</td>
                <td>{h.changeReason ?? '—'}</td>
              </tr>
            ))}
            {data.statusHistory.length === 0 && <tr><td colSpan={5} className="muted">No history.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
