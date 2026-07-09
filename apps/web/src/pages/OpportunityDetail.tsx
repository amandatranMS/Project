import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type Milestone, type Opportunity, type Recommendation } from '../api/client';
import { statusBadgeClass, formatCurrency, formatDate } from '../ui';

interface OpportunityDetailData extends Opportunity {
  milestones: Milestone[];
  dealTeamMembers: { id: string; memberName: string; role: string; isPrimary: boolean }[];
  collaborationNotes: { id: string; authorName: string; noteText: string; createdAt: string }[];
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
        <h1>{data.name}</h1>
        <span className={`badge ${statusBadgeClass(data.status)}`}>{data.status}</span>
      </div>

      <div className="card">
        <div className="grid cols-3">
          <div><div className="muted">Account</div>{data.accountName}</div>
          <div><div className="muted">Segment</div>{data.customerSegment}</div>
          <div><div className="muted">Deal Stage</div>{data.dealStage}</div>
          <div><div className="muted">Estimated Value</div>{formatCurrency(data.estimatedValue, data.currency)}</div>
          <div><div className="muted">Owner</div>{data.owner}</div>
          <div><div className="muted">Partner</div>{data.partnerName ?? '—'}</div>
          <div><div className="muted">Competitor</div>{data.competitorName ?? '—'} {data.competitorThreatLevel ? `(${data.competitorThreatLevel})` : ''}</div>
          <div><div className="muted">Risk Level</div>{data.riskLevel}</div>
          <div><div className="muted">Close Date</div>{formatDate(data.closeDate)}</div>
        </div>
        {data.riskNotes && (
          <p className="section muted">Risk notes: {data.riskNotes}</p>
        )}
      </div>

      <div className="card">
        <h2>Milestones</h2>
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Type</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Owner</th>
              <th>Due</th>
              <th>Risk</th>
            </tr>
          </thead>
          <tbody>
            {data.milestones.map((m) => (
              <tr key={m.id}>
                <td><Link to={`/milestones/${m.id}`}>{m.title}</Link></td>
                <td>{m.milestoneType}</td>
                <td><span className={`badge ${statusBadgeClass(m.status)}`}>{m.status}</span></td>
                <td>{m.priority}</td>
                <td>{m.owner}</td>
                <td>{formatDate(m.dueDate)}</td>
                <td>{m.riskScore}</td>
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
              <li key={d.id}>{d.memberName} — {d.role}{d.isPrimary ? ' (primary)' : ''}</li>
            ))}
            {data.dealTeamMembers.length === 0 && <li className="muted">No members.</li>}
          </ul>
        </div>
        <div className="card">
          <h2>Recommendations</h2>
          <ul>
            {data.recommendations.map((r) => (
              <li key={r.id}>{r.title} <span className={`badge ${statusBadgeClass(r.status)}`}>{r.status}</span></li>
            ))}
            {data.recommendations.length === 0 && <li className="muted">None.</li>}
          </ul>
        </div>
        <div className="card">
          <h2>Notes</h2>
          <ul>
            {data.collaborationNotes.map((n) => (
              <li key={n.id}><strong>{n.authorName}:</strong> {n.noteText}</li>
            ))}
            {data.collaborationNotes.length === 0 && <li className="muted">No notes.</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
