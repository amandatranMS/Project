import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Opportunity } from '../api/client';
import { statusBadgeClass, formatCurrency } from '../ui';

export default function Opportunities() {
  const [items, setItems] = useState<Opportunity[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Opportunity[]>('/opportunities')
      .then(setItems)
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <div className="page-header">
        <h1>Opportunities</h1>
      </div>
      {error && <p className="error">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Account</th>
            <th>Segment</th>
            <th>Stage</th>
            <th>Value</th>
            <th>Risk</th>
            <th>Milestones</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((o) => (
            <tr key={o.id}>
              <td>
                <Link to={`/opportunities/${o.id}`}>{o.name}</Link>
              </td>
              <td>{o.accountName}</td>
              <td>{o.customerSegment}</td>
              <td>{o.dealStage}</td>
              <td>{formatCurrency(o.estimatedValue, o.currency)}</td>
              <td>
                <span className={`badge ${statusBadgeClass(o.riskLevel === 'High' ? 'Blocked' : o.riskLevel === 'Medium' ? 'At Risk' : 'Completed')}`}>
                  {o.riskLevel}
                </span>
              </td>
              <td>{o._count?.milestones ?? 0}</td>
              <td>
                <span className={`badge ${statusBadgeClass(o.status)}`}>{o.status}</span>
              </td>
            </tr>
          ))}
          {items.length === 0 && !error && (
            <tr>
              <td colSpan={8} className="muted">
                No opportunities yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
