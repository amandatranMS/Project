import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { choiceLabel } from '@msx/shared';
import { api, type Milestone, type Opportunity, type Recommendation } from '../api/client';
import { statusBadgeClass, formatCurrency, formatDate } from '../ui';

interface OpportunityDetailData extends Opportunity {
  milestones: Milestone[];
  dealTeamMembers: { id: string; personName?: string | null; role?: string | null; active?: boolean | null }[];
  collaborationNotes: { id: string; createdBy?: string | null; noteSummary?: string | null }[];
  recommendations: Recommendation[];
}

export default function OpportunityDetail() {
  const { id } = useParams();
  const [data, setData] = useState<OpportunityDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api
      .get<OpportunityDetailData>(`/opportunities/${id}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [id]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;

  return (
    <div className="stack">
      <div className="page-header">
        <h1>{data.opportunityName}</h1>
        <span className={`badge ${statusBadgeClass(data.status)}`}>{data.status ?? '—'}</span>
      </div>

      <div className="card">
        <div className="grid cols-3">
          <div><div className="muted">Opportunity ID</div>{data.opportunityBusinessId}</div>
          <div><div className="muted">Customer</div>{data.customerName ?? '—'}</div>
          <div><div className="muted">Industry</div>{data.industry ?? '—'}</div>
          <div><div className="muted">Solution Area</div>{choiceLabel(data.solutionArea)}</div>
          <div><div className="muted">Sales Stage</div>{choiceLabel(data.salesStage)}</div>
          <div><div className="muted">Estimated Revenue</div>{formatCurrency(data.estimatedRevenue)}</div>
          <div><div className="muted">AE Owner</div>{data.aeOwner ?? '—'}</div>
          <div><div className="muted">Assigned SE</div>{data.assignedSE ?? '—'}</div>
          <div><div className="muted">Competitor</div>{data.competitorName ?? '—'}</div>
          <div><div className="muted">Close Date</div>{formatDate(data.closeDate)}</div>
        </div>
        {data.businessProblem && <p className="section muted">Business problem: {data.businessProblem}</p>}
        {data.nextStep && <p className="muted">Next step: {data.nextStep}</p>}
      </div>

      <div className="card">
        <h2>Milestones</h2>
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

      <div className="grid cols-3">
        <div className="card">
          <h2>Deal Team</h2>
          <ul>
            {data.dealTeamMembers.map((d) => (
              <li key={d.id}>{d.personName} — {d.role}{d.active ? '' : ' (inactive)'}</li>
            ))}
            {data.dealTeamMembers.length === 0 && <li className="muted">No members.</li>}
          </ul>
        </div>
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
