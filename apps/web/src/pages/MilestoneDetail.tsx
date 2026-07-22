import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useMsal } from '@azure/msal-react';
import { MILESTONE_STATUSES, LOST_TO_COMPETITOR, choiceLabel } from '@msx/shared';
import { api, type Milestone, type ManagerEmailOutcome, type GraphManager } from '../api/client';
import { statusBadgeClass, formatDate, formatBool, formatCurrency } from '../ui';
import MilestoneForm from '../components/form/MilestoneForm';
import Modal from '../components/Modal';
import LostToCompetitorDialog from '../components/LostToCompetitorDialog';

interface MilestoneDetailData extends Milestone {
  statusHistories: { id: string; oldStatus?: string | null; newStatus?: string | null; changedBy?: string | null; reason?: string | null; statusDate?: string | null }[];
}

const STATUSES = MILESTONE_STATUSES;

export default function MilestoneDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { accounts } = useMsal();
  const signedInName = accounts[0]?.name ?? accounts[0]?.username ?? 'Demo User';
  const [data, setData] = useState<MilestoneDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmingLost, setConfirmingLost] = useState(false);
  const [managerName, setManagerName] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function load() {
    if (!id) return;
    api
      .get<MilestoneDetailData>(`/milestones/${id}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }

  useEffect(load, [id]);

  async function handleDelete() {
    if (!id) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await api.del(`/milestones/${id}`);
      navigate('/milestones');
    } catch (e) {
      setDeleteError((e as Error).message);
    } finally {
      setDeleteBusy(false);
    }
  }

  function onStatusClick(newStatus: string) {
    setNotice(null);
    setError(null);
    if (newStatus === LOST_TO_COMPETITOR) {
      // Best-effort: name the manager in the pop-up (falls back to generic copy).
      setManagerName(null);
      api
        .get<{ manager: GraphManager | null }>('/graph/manager')
        .then((r) => setManagerName(r.manager?.displayName ?? r.manager?.mail ?? null))
        .catch(() => setManagerName(null));
      setConfirmingLost(true);
      return;
    }
    void changeStatus(newStatus);
  }

  async function changeStatus(newStatus: string, acknowledgeManagerEmail = false) {
    if (!data) return;
    setBusy(true);
    try {
      const res = await api.post<{ managerEmail?: ManagerEmailOutcome }>('/status-history', {
        milestoneBusinessId: data.milestoneBusinessId,
        newStatus,
        changedBy: signedInName,
        reason: 'Manual update from UI',
        acknowledgeManagerEmail,
      });
      setConfirmingLost(false);
      const outcome = res?.managerEmail;
      if (outcome?.attempted && outcome.sent) {
        setNotice(
          `Manager email ${outcome.simulated ? 'simulated (recorded in the audit log, not delivered)' : 'sent'}${
            outcome.managerEmail ? ` to ${outcome.managerEmail}` : ''
          }.`,
        );
      } else if (outcome?.attempted && !outcome.sent) {
        setNotice(`Status changed. Manager email not sent — ${outcome.skippedReason ?? 'unknown reason'}.`);
      }
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
          <button className="danger" onClick={() => { setDeleteError(null); setConfirmingDelete(true); }}>Delete</button>
          <span className={`badge ${statusBadgeClass(data.milestoneStatus)}`}>{choiceLabel(data.milestoneStatus)}</span>
        </div>
      </div>

      {editing && <MilestoneForm initial={data} onClose={() => setEditing(false)} onSaved={load} />}

      {confirmingDelete && (
        <Modal
          title="Delete milestone"
          onClose={() => setConfirmingDelete(false)}
          footer={
            <div className="btn-row">
              <button className="secondary" onClick={() => setConfirmingDelete(false)} disabled={deleteBusy}>Cancel</button>
              <button className="danger" onClick={handleDelete} disabled={deleteBusy}>
                {deleteBusy ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          }
        >
          <p>Delete <strong>{data.milestoneName}</strong>? This can’t be undone.</p>
          <p className="muted">Its status history will also be removed.</p>
          {deleteError && <p className="error">{deleteError}</p>}
        </Modal>
      )}

      <div className="card">
        <div className="grid cols-3">
          <div><div className="muted">Milestone ID</div>{data.milestoneBusinessId}</div>
          <div><div className="muted">Opportunity</div>{data.opportunity ? <Link to={`/opportunities/${data.opportunityId}`}>{data.opportunity.opportunityName}</Link> : '—'}</div>
          <div><div className="muted">Category</div>{choiceLabel(data.milestoneCategory)}</div>
          <div><div className="muted">Owner</div>{data.owner ?? '—'}</div>
          <div><div className="muted">Created By</div>{data.createdBy ?? '—'}</div>
          <div><div className="muted">Workload</div>{choiceLabel(data.workload)}</div>
          <div><div className="muted">Partner</div>{data.partnerName ?? '—'}</div>
          <div><div className="muted">Delivered By</div>{choiceLabel(data.deliveredBy)}</div>
          <div><div className="muted">Customer Commitment</div>{choiceLabel(data.customerCommitment)}</div>
          <div><div className="muted">Est Date</div>{formatDate(data.estDate)}</div>
          <div><div className="muted">Fit Charge</div>{formatCurrency(data.fitCharge)}</div>
          <div><div className="muted">Non-Recurring</div>{formatBool(data.nonRecurring)}</div>
          <div><div className="muted">Azure Capacity Type</div>{choiceLabel(data.azureCapacityType)}</div>
          <div><div className="muted">Preferred Azure Region</div>{choiceLabel(data.preferredAzureRegion)}</div>
          <div><div className="muted">Competitor</div>{data.competitorName ?? '—'}</div>
          <div><div className="muted">Risk Impact</div>{choiceLabel(data.riskImpact)}</div>
          <div><div className="muted">Status Reason</div>{data.statusReason ?? '—'}</div>
          <div><div className="muted">Last Updated</div>{formatDate(data.lastUpdated)}</div>
        </div>
        {data.riskDescription && <p className="section muted">Risk: {data.riskDescription}</p>}
        {data.mitigationPlan && <p className="muted">Mitigation: {data.mitigationPlan}</p>}
        {data.comments && <p className="muted">Comments: {data.comments}</p>}
      </div>

      <div className="card">
        <h2>Blocker</h2>
        <div className="grid cols-3">
          <div><div className="muted">Blocked Owner</div>{data.blockedOwner ?? '—'}</div>
          <div><div className="muted">Blocked Since</div>{formatDate(data.blockedSince)}</div>
          <div><div className="muted">Expected Resolution</div>{formatDate(data.expectedResolutionDate)}</div>
          <div><div className="muted">Escalated</div>{formatBool(data.escalated)}</div>
        </div>
        {data.blockedReason
          ? <p className="section muted">Reason: {data.blockedReason}</p>
          : <p className="section muted">Not blocked.</p>}
      </div>

      <div className="card">
        <h2>Change status</h2>
        {notice && <p style={{ color: 'var(--success)' }}>{notice}</p>}
        <div className="btn-row">
          {STATUSES.map((s) => (
            <button key={s} className="secondary" disabled={busy || s === data.milestoneStatus} onClick={() => onStatusClick(s)}>
              {choiceLabel(s)}
            </button>
          ))}
        </div>
      </div>

      {confirmingLost && (
        <LostToCompetitorDialog
          managerName={managerName}
          busy={busy}
          onCancel={() => setConfirmingLost(false)}
          onConfirm={() => void changeStatus(LOST_TO_COMPETITOR, true)}
        />
      )}

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
