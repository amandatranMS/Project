import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { MILESTONE_STATUSES, choiceLabel } from '@msx/shared';
import { api, type Milestone } from '../api/client';
import { statusBadgeClass, formatDate } from '../ui';
import MilestoneForm from '../components/form/MilestoneForm';

interface MilestoneDetailData extends Milestone {
  statusHistories: { id: string; oldStatus?: string | null; newStatus?: string | null; changedBy?: string | null; reason?: string | null; statusDate?: string | null }[];
  mitigationPlan?: string | null;
}

const STATUSES = MILESTONE_STATUSES;

export default function MilestoneDetail() {
  const { id } = useParams();
  const [data, setData] = useState<MilestoneDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  function load() {
    if (!id) return;
    api
      .get<MilestoneDetailData>(`/milestones/${id}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }

  useEffect(load, [id]);

  async function changeStatus(newStatus: string) {
    if (!data) return;
    setBusy(true);
    try {
      await api.post('/status-history', {
        milestoneBusinessId: data.milestoneBusinessId,
        newStatus,
        changedBy: 'Demo User',
        reason: 'Manual update from UI',
      });
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
        <h1>{data.milestoneName}</h1>
        <div className="btn-row">
          <button className="secondary" onClick={() => setEditing(true)}>Edit</button>
          <span className={`badge ${statusBadgeClass(data.milestoneStatus)}`}>{choiceLabel(data.milestoneStatus)}</span>
        </div>
      </div>

      {editing && <MilestoneForm initial={data} onClose={() => setEditing(false)} onSaved={load} />}

      <div className="card">
        <div className="grid cols-3">
          <div><div className="muted">Milestone ID</div>{data.milestoneBusinessId}</div>
          <div><div className="muted">Category</div>{choiceLabel(data.milestoneCategory)}</div>
          <div><div className="muted">Owner</div>{data.owner ?? '—'}</div>
          <div><div className="muted">Workload</div>{choiceLabel(data.workload)}</div>
          <div><div className="muted">Partner</div>{data.partnerName ?? '—'}</div>
          <div><div className="muted">Est Date</div>{formatDate(data.estDate)}</div>
          <div><div className="muted">Risk Impact</div>{choiceLabel(data.riskImpact)}</div>
          <div><div className="muted">Competitor</div>{data.competitorName ?? '—'}</div>
        </div>
        {data.riskDescription && <p className="section muted">Risk: {data.riskDescription}</p>}
        {data.mitigationPlan && <p className="muted">Mitigation: {data.mitigationPlan}</p>}
        {data.blockedReason && <p className="muted">Blocked: {data.blockedReason}</p>}
      </div>

      <div className="card">
        <h2>Change status</h2>
        <div className="btn-row">
          {STATUSES.map((s) => (
            <button key={s} className="secondary" disabled={busy || s === data.milestoneStatus} onClick={() => changeStatus(s)}>
              {choiceLabel(s)}
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
            {data.statusHistories.map((h) => (
              <tr key={h.id}>
                <td>{formatDate(h.statusDate)}</td>
                <td>{choiceLabel(h.oldStatus)}</td>
                <td><span className={`badge ${statusBadgeClass(h.newStatus)}`}>{choiceLabel(h.newStatus)}</span></td>
                <td>{h.changedBy ?? '—'}</td>
                <td>{h.reason ?? '—'}</td>
              </tr>
            ))}
            {data.statusHistories.length === 0 && <tr><td colSpan={5} className="muted">No history.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
