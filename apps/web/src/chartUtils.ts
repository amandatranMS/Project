// Client-side aggregation + color helpers for the dashboard charts.
// Small mock dataset → we aggregate in the browser from the existing list
// endpoints (no backend change) and re-slice on every cross-filter click.

export interface Slice {
  name: string;
  value: number;
}

export const norm = (v?: string | null) => (v == null || v === '' || v === '---' ? '(None)' : v);

/** Count items grouped by a string key (blank/"---" collapse into "(None)"). */
export function countBy<T>(items: T[], key: (x: T) => string | null | undefined): Slice[] {
  const map = new Map<string, number>();
  for (const it of items) {
    const name = norm(key(it));
    map.set(name, (map.get(name) ?? 0) + 1);
  }
  return [...map.entries()].map(([name, value]) => ({ name, value }));
}

/** Sum a numeric field grouped by a string key. */
export function sumBy<T>(
  items: T[],
  key: (x: T) => string | null | undefined,
  val: (x: T) => number | null | undefined,
): Slice[] {
  const map = new Map<string, number>();
  for (const it of items) {
    const name = norm(key(it));
    map.set(name, (map.get(name) ?? 0) + (val(it) ?? 0));
  }
  return [...map.entries()].map(([name, value]) => ({ name, value }));
}

// Status/impact values reuse the badge colors so charts match the rest of the UI;
// everything else falls back to the Copilot accent palette.
export const STATUS_COLORS: Record<string, string> = {
  'On Track': '#0e7a0b',
  Completed: '#0e7a0b',
  'At Risk': '#b45309',
  Blocked: '#c50f1f',
  'Lost To Competitor': '#c50f1f',
  Cancelled: '#6b7280',
  'Hygiene/Duplicate': '#6b7280',
  High: '#c50f1f',
  Medium: '#b45309',
  Low: '#0e7a0b',
  '(None)': '#c7ccda',
};

export const PALETTE = [
  '#2b6cff',
  '#6d5ce7',
  '#17b0c4',
  '#0f6cbd',
  '#b45309',
  '#0e7a0b',
  '#c50f1f',
  '#9a6700',
];

export const colorFor = (name: string, i: number) => STATUS_COLORS[name] ?? PALETTE[i % PALETTE.length];

// Recharts click handlers pass different payload shapes across chart types;
// this reads the category name from any of them.
export const nameOf = (e: unknown): string =>
  (e as { name?: string })?.name ??
  (e as { payload?: { name?: string } })?.payload?.name ??
  '';

/** Compact currency for axis ticks, e.g. $1.2M. */
export const compactCurrency = (v: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(v);
