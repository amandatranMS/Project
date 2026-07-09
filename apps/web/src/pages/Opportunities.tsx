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
            <th>ID</th>
            <th>Name</th>
            <th>Customer</th>
            <th>Solution Area</th>
            <th>Sales Stage</th>
            <th>Revenue</th>
            <th>Milestones</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((o) => (
            <tr key={o.id}>
              <td>{o.opportunityBusinessId}</td>
              <td>
                <Link to={`/opportunities/${o.id}`}>{o.opportunityName}</Link>
              </td>
              <td>{o.customerName ?? '—'}</td>
              <td>{o.solutionArea ?? '—'}</td>
              <td>{o.salesStage ?? '—'}</td>
              <td>{formatCurrency(o.estimatedRevenue)}</td>
              <td>{o._count?.milestones ?? 0}</td>
              <td>
                <span className={`badge ${statusBadgeClass(o.status)}`}>{o.status ?? '—'}</span>
              </td>
            </tr>
          ))}
          {items.length === 0 && !error && (
            <tr>
              <td colSpan={8} className="muted">
                No opportunities yet. Run <code>npm run import-workbook</code>.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
