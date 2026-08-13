import { useState } from 'react';
import { choiceLabel } from '@msx/shared';
import { statusBadgeClass, formatDate, formatDuration } from '../ui';

interface StatusHistoryEntry {
  id: string;
  oldStatus?: string | null;
  newStatus?: string | null;
  changedBy?: string | null;
  reason?: string | null;
  statusDate?: string | null;
}

// Shipping-tracker-style vertical timeline for milestone status history.
// Renders oldest → newest top-to-bottom, highlights the current status,
// and shows how long the milestone spent in each prior stage.
export default function MilestoneTimeline({ history }: { history: StatusHistoryEntry[] }) {
  const [expanded, setExpanded] = useState(false);

  if (history.length === 0) {
    return <p className="muted">No history.</p>;
  }

  // History arrives newest-first from the API; render oldest-first so the
  // timeline reads top-to-bottom like a package tracker.
  const chronological = [...history].reverse();
  const COLLAPSED_COUNT = 4;
  const shouldCollapse = chronological.length > COLLAPSED_COUNT;
  const visible = shouldCollapse && !expanded ? chronological.slice(-COLLAPSED_COUNT) : chronological;
  const hiddenCount = chronological.length - visible.length;

  return (
    <div className="timeline">
      {shouldCollapse && !expanded && (
        <button className="secondary timeline-more" onClick={() => setExpanded(true)}>
          Show {hiddenCount} earlier update{hiddenCount === 1 ? '' : 's'}
        </button>
      )}
      <ol className="timeline-list">
        {visible.map((h, i) => {
          const isCurrent = i === visible.length - 1;
          const prev = visible[i - 1];
          const duration = prev ? formatDuration(prev.statusDate, h.statusDate) : null;
          return (
            <li key={h.id} className={`timeline-item ${isCurrent ? 'current' : ''}`}>
              <span className={`timeline-dot ${statusBadgeClass(h.newStatus)}`} aria-hidden="true" />
              <div className="timeline-content">
                <div className="timeline-head">
                  <span className={`badge ${statusBadgeClass(h.newStatus)}`}>{choiceLabel(h.newStatus)}</span>
                  {isCurrent && <span className="timeline-current-tag">Current</span>}
                  <span className="timeline-date">{formatDate(h.statusDate)}</span>
                </div>
                <div className="timeline-meta muted">
                  {h.oldStatus ? `From ${choiceLabel(h.oldStatus)} · ` : ''}
                  {h.changedBy ?? 'Unknown'}
                  {duration ? ` · spent ${duration} in ${choiceLabel(prev?.newStatus)}` : ''}
                </div>
                {h.reason && <div className="timeline-reason">{h.reason}</div>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
