import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Milestone } from '../api/client';
import { statusBadgeClass, formatDate } from '../ui';

export default function Milestones() {
  const [items, setItems] = useState<Milestone[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Milestone[]>('/milestones')
      .then(setItems)
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <div className="page-header">
        <h1>Milestones</h1>
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
              <td>{m.milestoneCategory ?? '—'}</td>
              <td><span className={`badge ${statusBadgeClass(m.milestoneStatus)}`}>{m.milestoneStatus ?? '—'}</span></td>
              <td>{m.owner ?? '—'}</td>
              <td>{formatDate(m.estDate)}</td>
              <td>{m.riskImpact ?? '—'}</td>
            </tr>
          ))}
          {items.length === 0 && !error && (
            <tr><td colSpan={8} className="muted">No milestones yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
