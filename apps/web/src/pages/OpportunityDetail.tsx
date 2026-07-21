import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { choiceLabel } from '@msx/shared';
import { api, type Milestone, type Opportunity, type Recommendation, type DealTeamMember } from '../api/client';
import { statusBadgeClass, formatCurrency, formatDate, formatBool } from '../ui';
import OpportunityForm from '../components/form/OpportunityForm';
import MilestoneForm from '../components/form/MilestoneForm';
import DealTeamForm from '../components/form/DealTeamForm';
import Modal from '../components/Modal';

interface OpportunityDetailData extends Opportunity {
  milestones: Milestone[];
  dealTeamMembers: DealTeamMember[];
  collaborationNotes: { id: string; createdBy?: string | null; noteSummary?: string | null }[];
  recommendations: Recommendation[];
}

export default function OpportunityDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<OpportunityDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [addingMilestone, setAddingMilestone] = useState(false);
  const [addingMember, setAddingMember] = useState(false);
  const [editingMember, setEditingMember] = useState<DealTeamMember | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [cascade, setCascade] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function load() {
    if (!id) return;
    api
      .get<OpportunityDetailData>(`/opportunities/${id}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }

  useEffect(load, [id]);

  async function handleDelete() {
    if (!id) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await api.del(`/opportunities/${id}?cascade=${cascade}`);
      navigate('/opportunities');
    } catch (e) {
      setDeleteError((e as Error).message);
    } finally {
      setDeleteBusy(false);
    }
  }

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;

  const milestoneCount = data.milestones.length;
  const canDelete = milestoneCount === 0 || cascade;

  return (
    <div className="stack">
      <div className="page-header">
        <h1>{data.opportunityName}</h1>
        <div className="btn-row">
          <button className="secondary" onClick={() => setEditing(true)}>Edit</button>
          <button className="danger" onClick={() => { setCascade(false); setDeleteError(null); setConfirmingDelete(true); }}>Delete</button>
          <span className={`badge ${statusBadgeClass(data.status)}`}>{choiceLabel(data.status)}</span>
        </div>
      </div>

      {editing && <OpportunityForm initial={data} onClose={() => setEditing(false)} onSaved={load} />}
      {addingMilestone && (
        <MilestoneForm
          defaultOpportunityName={data.opportunityName}
          onClose={() => setAddingMilestone(false)}
          onSaved={load}
        />
      )}
      {addingMember && (
        <DealTeamForm
          opportunityName={data.opportunityName}
          onClose={() => setAddingMember(false)}
          onSaved={load}
        />
      )}
      {editingMember && (
        <DealTeamForm
          initial={editingMember}
          opportunityName={data.opportunityName}
          onClose={() => setEditingMember(null)}
          onSaved={load}
        />
      )}

      {confirmingDelete && (
        <Modal
          title="Delete opportunity"
          onClose={() => setConfirmingDelete(false)}
          footer={
            <div className="btn-row">
              <button className="secondary" onClick={() => setConfirmingDelete(false)} disabled={deleteBusy}>Cancel</button>
              <button className="danger" onClick={handleDelete} disabled={!canDelete || deleteBusy}>
                {deleteBusy ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          }
        >
          <p>Delete <strong>{data.opportunityName}</strong>? This can’t be undone.</p>
          {milestoneCount > 0 && (
            <>
              <p className="muted">
                This opportunity has <strong>{milestoneCount}</strong> milestone(s) plus any related notes,
                recommendations and approvals. You must confirm a cascade delete to remove them all.
              </p>
              <label className="row">
                <input type="checkbox" checked={cascade} onChange={(e) => setCascade(e.target.checked)} />
                <span>Also delete all {milestoneCount} milestone(s) and related records</span>
              </label>
            </>
          )}
          {deleteError && <p className="error">{deleteError}</p>}
        </Modal>
      )}

      <div className="card">
        <div className="grid cols-3">
          <div><div className="muted">Opportunity ID</div>{data.opportunityBusinessId}</div>
          <div><div className="muted">TPID</div>{data.tpid ?? '—'}</div>
          <div><div className="muted">Customer</div>{data.customerName ?? '—'}</div>
          <div><div className="muted">Industry</div>{data.industry ?? '—'}</div>
          <div><div className="muted">Solution Area</div>{choiceLabel(data.solutionArea)}</div>
          <div><div className="muted">Sales Stage</div>{choiceLabel(data.salesStage)}</div>
          <div><div className="muted">Estimated Revenue</div>{formatCurrency(data.estimatedRevenue)}</div>
          <div><div className="muted">AE Owner</div>{data.aeOwner ?? '—'}</div>
          <div><div className="muted">Assigned SE</div>{data.assignedSE ?? '—'}</div>
          <div><div className="muted">Competitor</div>{data.competitorName ?? '—'}</div>
          <div><div className="muted">Close Date</div>{formatDate(data.closeDate)}</div>
          <div><div className="muted">Consumption Phase</div>{data.consumptionPhase ?? '—'}</div>
          <div><div className="muted">Last Updated</div>{formatDate(data.lastUpdated)}</div>
        </div>
        {data.businessProblem && <p className="section muted">Business problem: {data.businessProblem}</p>}
        {data.nextStep && <p className="muted">Next step: {data.nextStep}</p>}
      </div>

      <div className="card">
        <div className="spread">
          <h2>Milestones</h2>
          <button className="secondary" onClick={() => setAddingMilestone(true)}>+ Add milestone</button>
        </div>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Category</th>
              <th>Status</th>
              <th>Owner</th>
              <th>Est Date</th>
              <th>Risk</th>
            </tr>
          </thead>
          <tbody>
            {data.milestones.map((m) => (
              <tr key={m.id}>
                <td>{m.milestoneBusinessId}</td>
                <td><Link to={`/milestones/${m.id}`}>{m.milestoneName}</Link></td>
                <td>{choiceLabel(m.milestoneCategory)}</td>
                <td><span className={`badge ${statusBadgeClass(m.milestoneStatus)}`}>{choiceLabel(m.milestoneStatus)}</span></td>
                <td>{m.owner ?? '—'}</td>
                <td>{formatDate(m.estDate)}</td>
                <td>{choiceLabel(m.riskImpact)}</td>
              </tr>
            ))}
            {data.milestones.length === 0 && (
              <tr><td colSpan={7} className="muted">No milestones.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="spread">
          <h2>Deal Team</h2>
          <button className="secondary" onClick={() => setAddingMember(true)}>+ Add member</button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Team Area</th>
              <th>Added</th>
              <th>Active</th>
              <th>Handoff</th>
              <th>Handoff Notes</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.dealTeamMembers.map((d) => (
              <tr key={d.id}>
                <td>{d.personName ?? '—'}</td>
                <td>{d.role ?? '—'}</td>
                <td>{d.teamArea ?? '—'}</td>
                <td>{formatDate(d.addedDate)}</td>
                <td>{formatBool(d.active)}</td>
                <td>{formatBool(d.handoffRequired)}</td>
                <td>{d.handoffNotes ?? '—'}</td>
                <td><button className="secondary" onClick={() => setEditingMember(d)}>Edit</button></td>
              </tr>
            ))}
            {data.dealTeamMembers.length === 0 && (
              <tr><td colSpan={8} className="muted">No members.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="grid cols-3">
        <div className="card">
          <h2>Recommendations</h2>
          <ul>
            {data.recommendations.map((r) => (
              <li key={r.id}>{r.recommendedMilestoneTitle} <span className={`badge ${statusBadgeClass(r.reviewStatus)}`}>{choiceLabel(r.reviewStatus)}</span></li>
            ))}
            {data.recommendations.length === 0 && <li className="muted">None.</li>}
          </ul>
        </div>
        <div className="card">
          <h2>Notes</h2>
          <ul>
            {data.collaborationNotes.map((n) => (
              <li key={n.id}><strong>{n.createdBy}:</strong> {n.noteSummary}</li>
            ))}
            {data.collaborationNotes.length === 0 && <li className="muted">No notes.</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
