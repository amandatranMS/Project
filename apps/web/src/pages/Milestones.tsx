import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MILESTONE_STATUSES, choiceLabel } from '@msx/shared';
import { api, type Milestone } from '../api/client';
import { statusBadgeClass, formatDate } from '../ui';
import FilterSelect from '../components/FilterSelect';

export default function Milestones() {
  const [items, setItems] = useState<Milestone[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [milestoneStatus, setMilestoneStatus] = useState('');

  useEffect(() => {
    const params = new URLSearchParams();
    if (milestoneStatus) params.set('milestoneStatus', milestoneStatus);
    const qs = params.toString();
    api
      .get<Milestone[]>(`/milestones${qs ? `?${qs}` : ''}`)
      .then(setItems)
      .catch((e) => setError(e.message));
  }, [milestoneStatus]);

  return (
    <div>
      <div className="page-header">
        <h1>Milestones</h1>
      </div>

      <div className="filters">
        <FilterSelect label="Milestone Status" value={milestoneStatus} options={MILESTONE_STATUSES} onChange={setMilestoneStatus} allLabel="All statuses" />
      </div>

      {error && <p className="error">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Opportunity</th>
            <th>Category</th>
            <th>Status</th>
            <th>Owner</th>
            <th>Est Date</th>
            <th>Risk</th>
          </tr>
        </thead>
        <tbody>
          {items.map((m) => (
            <tr key={m.id}>
              <td>{m.milestoneBusinessId}</td>
              <td><Link to={`/milestones/${m.id}`}>{m.milestoneName}</Link></td>
              <td>{m.opportunity?.opportunityName ?? '—'}</td>
              <td>{choiceLabel(m.milestoneCategory)}</td>
              <td><span className={`badge ${statusBadgeClass(m.milestoneStatus)}`}>{choiceLabel(m.milestoneStatus)}</span></td>
              <td>{m.owner ?? '—'}</td>
              <td>{formatDate(m.estDate)}</td>
              <td>{choiceLabel(m.riskImpact)}</td>
            </tr>
          ))}
          {items.length === 0 && !error && (
            <tr><td colSpan={8} className="muted">No milestones match this filter.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
