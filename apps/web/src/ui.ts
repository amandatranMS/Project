// Small shared UI helpers.

export function statusBadgeClass(status: string): string {
  switch (status) {
    case 'Completed':
    case 'Won':
    case 'Approved':
    case 'Succeeded':
      return 'green';
    case 'In Progress':
    case 'Open':
    case 'Proposed':
    case 'Submitted':
      return 'blue';
    case 'At Risk':
    case 'Pending':
    case 'On Hold':
      return 'amber';
    case 'Blocked':
    case 'Lost':
    case 'Rejected':
    case 'Failed':
    case 'Denied':
      return 'red';
    default:
      return 'gray';
  }
}

export function formatCurrency(value: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
}

export function formatDate(value?: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
