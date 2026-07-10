import { useEffect, useState } from 'react';
import { api, type DashboardMetrics } from '../api/client';
import { formatCurrency } from '../ui';

export default function Dashboard() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<DashboardMetrics>('/dashboard/summary')
      .then(setMetrics)
      .catch((e) => setError(e.message));
  }, []);

  const cards = metrics
    ? [
        { label: 'Active Opportunities', value: metrics.activeOpportunities },
        { label: 'Pipeline Value', value: formatCurrency(metrics.pipelineValue) },
        { label: 'Total Milestones', value: metrics.totalMilestones },
        { label: 'Milestones At Risk', value: metrics.milestonesAtRisk },
        { label: 'Blocked Milestones', value: metrics.blockedMilestones },
        { label: 'Pending Approvals', value: metrics.pendingApprovals },
      ]
    : [];

  return (
    <div>
      <div className="page-header">
        <h1>Dashboard</h1>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="grid cols-4">
        {cards.map((c) => (
          <div key={c.label} className="card metric">
            <div className="value">{c.value}</div>
            <div className="label">{c.label}</div>
          </div>
        ))}
      </div>
      {!metrics && !error && <p className="muted">Loading metrics…</p>}
    </div>
  );
}
