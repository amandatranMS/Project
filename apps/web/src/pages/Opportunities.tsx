import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { SOLUTION_AREAS, SALES_STAGES, OPPORTUNITY_STATUSES, FORECAST_CATEGORIES, choiceLabel } from '@msx/shared';
import { api, type Opportunity } from '../api/client';
import { statusBadgeClass, formatCurrency, formatDate } from '../ui';
import FilterSelect from '../components/FilterSelect';
import OpportunityForm from '../components/form/OpportunityForm';

export default function Opportunities() {
  const [items, setItems] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Search + filters (applied client-side).
  const [search, setSearch] = useState('');
  const [account, setAccount] = useState('');
  const [solutionArea, setSolutionArea] = useState('');
  const [salesStage, setSalesStage] = useState('');
  const [forecastCategory, setForecastCategory] = useState('');
  const [competitor, setCompetitor] = useState('');
  const [milestones, setMilestones] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    api
      .get<Opportunity[]>('/opportunities')
      .then(setItems)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [refreshKey]);

  const distinct = (values: (string | null | undefined)[]) =>
    Array.from(new Set(values.filter((v): v is string => Boolean(v)))).sort();

  const accounts = useMemo(() => distinct(items.map((o) => o.customerName)), [items]);
  const competitors = useMemo(() => distinct(items.map((o) => o.competitorName)), [items]);
  const milestoneCounts = useMemo(
    () =>
      Array.from(new Set(items.map((o) => o._count?.milestones ?? 0)))
        .sort((a, b) => a - b)
        .map(String),
    [items],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((o) => {
      const matchesSearch =
        !q ||
        [o.opportunityBusinessId, o.opportunityName, o.customerName].some((v) => v?.toLowerCase().includes(q));
      return (
        matchesSearch &&
        (!account || o.customerName === account) &&
        (!solutionArea || o.solutionArea === solutionArea) &&
        (!salesStage || o.salesStage === salesStage) &&
        (!forecastCategory || o.forecastCategory === forecastCategory) &&
        (!competitor || o.competitorName === competitor) &&
        (!milestones || String(o._count?.milestones ?? 0) === milestones) &&
        (!status || o.status === status)
      );
    });
  }, [items, search, account, solutionArea, salesStage, forecastCategory, competitor, milestones, status]);

  const clearAll = () => {
    setSearch('');
    setAccount('');
    setSolutionArea('');
    setSalesStage('');
    setForecastCategory('');
    setCompetitor('');
    setMilestones('');
    setStatus('');
  };

  return (
    <div>
      <div className="page-header">
        <h1>Opportunities</h1>
        <button onClick={() => setShowForm(true)}>+ New opportunity</button>
      </div>

      {showForm && <OpportunityForm onClose={() => setShowForm(false)} onSaved={() => setRefreshKey((k) => k + 1)} />}

      <div className="filters">
        <div className="field">
          <label>Search</label>
          <input
            type="search"
            placeholder="ID, name, or account…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <FilterSelect label="Account" value={account} options={accounts} onChange={setAccount} allLabel="All accounts" />
        <FilterSelect label="Solution Area" value={solutionArea} options={SOLUTION_AREAS} onChange={setSolutionArea} allLabel="All solution areas" />
        <FilterSelect label="Sales Stage" value={salesStage} options={SALES_STAGES} onChange={setSalesStage} allLabel="All sales stages" />
        <FilterSelect label="Forecast" value={forecastCategory} options={FORECAST_CATEGORIES} onChange={setForecastCategory} allLabel="All forecasts" />
        <FilterSelect label="Competitor" value={competitor} options={competitors} onChange={setCompetitor} allLabel="All competitors" />
        <FilterSelect label="Milestones" value={milestones} options={milestoneCounts} onChange={setMilestones} allLabel="Any count" />
        <FilterSelect label="Status" value={status} options={OPPORTUNITY_STATUSES} onChange={setStatus} allLabel="All statuses" />
        <div className="field">
          <label>&nbsp;</label>
          <button className="secondary" onClick={clearAll}>Clear</button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      <p className="muted">Showing {filtered.length} of {items.length} opportunities.</p>
      <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Account</th>
            <th>TPID</th>
            <th>Solution Area</th>
            <th>Sales Stage</th>
            <th>Forecast</th>
            <th>Est. Revenue</th>
            <th>Competitor</th>
            <th>Est. Close Date</th>
            <th>Milestones</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {loading &&
            Array.from({ length: 6 }).map((_, i) => (
              <tr key={`sk-${i}`} className="skeleton-row">
                <td colSpan={12}>
                  <span className="skeleton-line" />
                </td>
              </tr>
            ))}
          {!loading && filtered.map((o) => (
            <tr key={o.id}>
              <td>{o.opportunityBusinessId}</td>
              <td>
                <Link to={`/opportunities/${o.id}`}>{o.opportunityName}</Link>
              </td>
              <td>{o.customerName ?? '—'}</td>
              <td>{o.tpid ?? '—'}</td>
              <td>{choiceLabel(o.solutionArea)}</td>
              <td>{choiceLabel(o.salesStage)}</td>
              <td>
                {o.forecastCategory
                  ? <span className={`badge ${statusBadgeClass(o.forecastCategory)}`}>{o.forecastCategory}</span>
                  : '—'}
              </td>
              <td>{formatCurrency(o.estimatedRevenue)}</td>
              <td>{o.competitorName ?? '—'}</td>
              <td>{formatDate(o.closeDate)}</td>
              <td>{o._count?.milestones ?? 0}</td>
              <td>
                <span className={`badge ${statusBadgeClass(o.status)}`}>{choiceLabel(o.status)}</span>
              </td>
            </tr>
          ))}
          {!loading && filtered.length === 0 && !error && (
            <tr>
              <td colSpan={12} className="muted">
                No opportunities match your search or filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}
