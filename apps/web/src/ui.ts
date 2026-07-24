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
    case 'Contracted':
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
    case 'Verbal':
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
