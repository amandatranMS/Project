import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { SOLUTION_AREAS, SALES_STAGES, OPPORTUNITY_STATUSES, choiceLabel } from '@msx/shared';
import { api, type Opportunity } from '../api/client';
import { statusBadgeClass, formatCurrency, formatDate } from '../ui';
import FilterSelect from '../components/FilterSelect';
import OpportunityForm from '../components/form/OpportunityForm';

export default function Opportunities() {
  const [items, setItems] = useState<Opportunity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [solutionArea, setSolutionArea] = useState('');
  const [salesStage, setSalesStage] = useState('');
  const [status, setStatus] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams();
    if (solutionArea) params.set('solutionArea', solutionArea);
    if (salesStage) params.set('salesStage', salesStage);
    if (status) params.set('status', status);
    const qs = params.toString();
    api
      .get<Opportunity[]>(`/opportunities${qs ? `?${qs}` : ''}`)
      .then(setItems)
      .catch((e) => setError(e.message));
  }, [solutionArea, salesStage, status, refreshKey]);

  return (
    <div>
      <div className="page-header">
        <h1>Opportunities</h1>
        <button onClick={() => setShowForm(true)}>+ New opportunity</button>
      </div>

      {showForm && (
        <OpportunityForm onClose={() => setShowForm(false)} onSaved={() => setRefreshKey((k) => k + 1)} />
      )}

      <div className="filters">
        <FilterSelect label="Solution Area" value={solutionArea} options={SOLUTION_AREAS} onChange={setSolutionArea} allLabel="All solution areas" />
        <FilterSelect label="Sales Stage" value={salesStage} options={SALES_STAGES} onChange={setSalesStage} allLabel="All sales stages" />
        <FilterSelect label="Status" value={status} options={OPPORTUNITY_STATUSES} onChange={setStatus} allLabel="All statuses" />
      </div>

      {error && <p className="error">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Account</th>
            <th>TPID</th>
            <th>Solution Area</th>
            <th>Sales Stage</th>
            <th>Est. Revenue</th>
            <th>Competitor</th>
            <th>Est. Close Date</th>
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
              <td>{o.tpid ?? '—'}</td>
              <td>{choiceLabel(o.solutionArea)}</td>
              <td>{choiceLabel(o.salesStage)}</td>
              <td>{formatCurrency(o.estimatedRevenue)}</td>
              <td>{o.competitorName ?? '—'}</td>
              <td>{formatDate(o.closeDate)}</td>
              <td>{o._count?.milestones ?? 0}</td>
              <td>
                <span className={`badge ${statusBadgeClass(o.status)}`}>{choiceLabel(o.status)}</span>
              </td>
            </tr>
          ))}
          {items.length === 0 && !error && (
            <tr>
              <td colSpan={11} className="muted">
                No opportunities match these filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
