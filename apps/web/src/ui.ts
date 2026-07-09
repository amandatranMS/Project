// Small shared UI helpers.

export function statusBadgeClass(status?: string | null): string {
  switch (status) {
    case 'Completed':
    case 'On Track':
    case 'Won':
    case 'Approved':
    case 'Active':
    case 'Success':
      return 'green';
    case 'In Progress':
    case 'Reviewed':
    case 'Read':
      return 'blue';
    case 'At Risk':
    case 'Pending':
    case 'On Hold':
      return 'amber';
    case 'Blocked':
    case 'Lost':
    case 'Lost to Competitor':
    case 'Rejected':
    case 'Failed':
    case 'Denied':
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
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
