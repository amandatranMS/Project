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
            <th>Title</th>
            <th>Opportunity</th>
            <th>Type</th>
            <th>Status</th>
            <th>Priority</th>
            <th>Owner</th>
            <th>Due</th>
            <th>Blocker</th>
          </tr>
        </thead>
        <tbody>
          {items.map((m) => (
            <tr key={m.id}>
              <td><Link to={`/milestones/${m.id}`}>{m.title}</Link></td>
              <td>{m.opportunity?.name ?? '—'}</td>
              <td>{m.milestoneType}</td>
              <td><span className={`badge ${statusBadgeClass(m.status)}`}>{m.status}</span></td>
              <td>{m.priority}</td>
              <td>{m.owner}</td>
              <td>{formatDate(m.dueDate)}</td>
              <td>{m.blockerStatus !== 'None' ? m.blockerStatus : '—'}</td>
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
