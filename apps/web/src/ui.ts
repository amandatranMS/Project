// Small shared UI helpers.

export function statusBadgeClass(status?: string | null): string {
  switch (status) {
    case 'Completed':
    case 'On Track':
    case 'Won':
    case 'Approved':
    case 'Active':
    case 'Success':
    case 'Committed':
      return 'green';
    case 'In Progress':
    case 'Reviewed':
    case 'Read':
    case 'Submitted':
      return 'blue';
    case 'At Risk':
    case 'Pending':
    case 'On Hold':
    case 'Needs Changes':
    case 'Warning':
    case 'Uncommitted':
      return 'amber';
    case 'Blocked':
    case 'Lost':
    case 'Lost to Competitor':
    case 'Lost To Competitor':
    case 'Cancelled':
    case 'Rejected':
    case 'Failed':
    case 'Denied':
    case 'Critical':
      return 'red';
    default:
      return 'gray';
  }
}

export function formatCurrency(value?: number | null, currency = 'USD'): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
}

export function formatDate(value?: string | null): string {
  if (!value) return '—';
  const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const d = dateOnly
    ? new Date(`${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}T12:00:00.000Z`)
    : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'America/New_York',
  });
}

export function formatBool(value?: boolean | null): string {
  if (value == null) return '—';
  return value ? 'Yes' : 'No';
}

// Human-friendly gap between two dates, e.g. "3 days", "2 hrs", "5 wks".
// Used to show how long a milestone sat in a given status.
export function formatDuration(fromIso?: string | null, toIso?: string | null): string | null {
  if (!fromIso || !toIso) return null;
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  const ms = Math.max(0, to - from);
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins || 1} min${mins === 1 ? '' : 's'}`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? '' : 's'}`;
  const days = Math.round(hrs / 24);
  if (days < 14) return `${days} day${days === 1 ? '' : 's'}`;
  const weeks = Math.round(days / 7);
  if (weeks < 8) return `${weeks} wk${weeks === 1 ? '' : 's'}`;
  const months = Math.round(days / 30);
  return `${months} mo${months === 1 ? '' : 's'}`;
}
