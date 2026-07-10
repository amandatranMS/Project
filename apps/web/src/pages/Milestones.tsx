import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MILESTONE_STATUSES, choiceLabel } from '@msx/shared';
import { api, type Milestone } from '../api/client';
import { statusBadgeClass, formatDate } from '../ui';
import FilterSelect from '../components/FilterSelect';
import MilestoneForm from '../components/form/MilestoneForm';

export default function Milestones() {
  const [items, setItems] = useState<Milestone[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [milestoneStatus, setMilestoneStatus] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams();
    if (milestoneStatus) params.set('milestoneStatus', milestoneStatus);
    const qs = params.toString();
    api
      .get<Milestone[]>(`/milestones${qs ? `?${qs}` : ''}`)
      .then(setItems)
      .catch((e) => setError(e.message));
  }, [milestoneStatus, refreshKey]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((m) =>
      [
        m.milestoneBusinessId,
        m.milestoneName,
        m.opportunity?.opportunityName,
        m.milestoneCategory,
        m.milestoneStatus,
        m.owner,
        m.riskImpact,
        m.riskDescription,
      ].some((v) => v?.toLowerCase().includes(q)),
    );
  }, [items, search]);

  return (
    <div>
      <div className="page-header">
        <h1>Milestones</h1>
        <button onClick={() => setShowForm(true)}>+ New milestone</button>
      </div>

      {showForm && (
        <MilestoneForm onClose={() => setShowForm(false)} onSaved={() => setRefreshKey((k) => k + 1)} />
      )}

      <div className="filters">
        <div className="field">
          <label>Search</label>
          <input
            type="search"
            placeholder="ID, name, opportunity, category, status, owner, risk…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <FilterSelect label="Milestone Status" value={milestoneStatus} options={MILESTONE_STATUSES} onChange={setMilestoneStatus} allLabel="All statuses" />
      </div>

      {error && <p className="error">{error}</p>}
      <p className="muted">Showing {filtered.length} of {items.length} milestones.</p>
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
          {filtered.map((m) => (
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
          {filtered.length === 0 && !error && (
            <tr><td colSpan={8} className="muted">No milestones match your search or filter.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
