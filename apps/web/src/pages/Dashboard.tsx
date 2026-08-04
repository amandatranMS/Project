import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  PieChart,
  Pie,
  Cell,
  RadialBarChart,
  RadialBar,
  PolarAngleAxis,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Label,
  ResponsiveContainer,
} from 'recharts';
import { choiceLabel } from '@msx/shared';
import { api, type DashboardMetrics, type Milestone, type Opportunity } from '../api/client';
import { statusBadgeClass, formatCurrency, formatDate } from '../ui';
import { countBy, sumBy, colorFor, nameOf, compactCurrency, norm } from '../chartUtils';

// Dimensions the user can cross-filter on. Milestone dims filter milestones
// directly; opportunity dims filter opportunities and, through them, the
// milestones that belong to the matching opportunities.
type MilestoneDim = 'milestoneStatus' | 'milestoneCategory' | 'riskImpact';
type OpportunityDim = 'solutionArea' | 'salesStage';
type Dim = MilestoneDim | OpportunityDim;
interface Filter {
  dim: Dim;
  value: string;
}

const isOppDim = (d: Dim): d is OpportunityDim => d === 'solutionArea' || d === 'salesStage';

const DIM_LABELS: Record<Dim, string> = {
  milestoneStatus: 'Status',
  milestoneCategory: 'Category',
  riskImpact: 'Risk',
  solutionArea: 'Solution Area',
  salesStage: 'Stage',
};

export default function Dashboard() {
  const [miles, setMiles] = useState<Milestone[]>([]);
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [summary, setSummary] = useState<DashboardMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filter[]>([]);

  useEffect(() => {
    Promise.all([
      api.get<Milestone[]>('/milestones'),
      api.get<Opportunity[]>('/opportunities'),
      api.get<DashboardMetrics>('/dashboard/summary'),
    ])
      .then(([m, o, s]) => {
        setMiles(m);
        setOpps(o);
        setSummary(s);
      })
      .catch((e) => setError(e.message));
  }, []);

  const toggle = (dim: Dim, value: string) =>
    setFilters((fs) =>
      fs.some((f) => f.dim === dim && f.value === value)
        ? fs.filter((f) => !(f.dim === dim && f.value === value))
        : [...fs, { dim, value }],
    );

  const removeFilter = (dim: Dim, value: string) =>
    setFilters((fs) => fs.filter((f) => !(f.dim === dim && f.value === value)));

  // Selected values grouped by dimension. Multiple values within one dimension
  // are OR'd; different dimensions are AND'd (Power BI-style multi-select).
  const selected = useMemo(() => {
    const opp = new Map<OpportunityDim, Set<string>>();
    const mile = new Map<MilestoneDim, Set<string>>();
    for (const f of filters) {
      if (isOppDim(f.dim)) {
        const set = opp.get(f.dim) ?? new Set<string>();
        set.add(f.value);
        opp.set(f.dim, set);
      } else {
        const set = mile.get(f.dim) ?? new Set<string>();
        set.add(f.value);
        mile.set(f.dim, set);
      }
    }
    return { opp, mile };
  }, [filters]);

  // An entity matches when, for every dimension it is filtered on, its value is
  // one of the selected values. Chart slice names come from `norm`, so compare
  // on `norm` too (this also matches the "(None)" slice correctly).
  const oppSelfMatch = useCallback(
    (o: Opportunity) => {
      for (const [dim, vals] of selected.opp) {
        if (!vals.has(norm(o[dim]))) return false;
      }
      return true;
    },
    [selected],
  );
  const mileSelfMatch = useCallback(
    (m: Milestone) => {
      for (const [dim, vals] of selected.mile) {
        if (!vals.has(norm(m[dim]))) return false;
      }
      return true;
    },
    [selected],
  );

  // Linked cross-filter: opportunities must match their own dims and (when any
  // milestone dim is filtered) own at least one matching milestone; milestones
  // must match their own dims and belong to a matching opportunity.
  const filteredOpps = useMemo(() => {
    const matches = opps.filter(oppSelfMatch);
    if (selected.mile.size === 0) return matches;
    const ownerIds = new Set(miles.filter(mileSelfMatch).map((m) => m.opportunityId));
    return matches.filter((o) => ownerIds.has(o.id));
  }, [opps, miles, selected, oppSelfMatch, mileSelfMatch]);

  const filteredMiles = useMemo(() => {
    const matches = miles.filter(mileSelfMatch);
    if (selected.opp.size === 0) return matches;
    const okOppIds = new Set(opps.filter(oppSelfMatch).map((o) => o.id));
    return matches.filter((m) => okOppIds.has(m.opportunityId));
  }, [miles, opps, selected, mileSelfMatch, oppSelfMatch]);

  // Chart series are computed from the FULL sets so every category stays visible;
  // selected slices stay lit and the rest dim (Power BI cross-highlight feel).
  const byStatus = useMemo(() => countBy(miles, (m) => m.milestoneStatus), [miles]);
  const byRisk = useMemo(() => countBy(miles.filter((m) => m.riskImpact), (m) => m.riskImpact), [miles]);
  const bySolutionArea = useMemo(() => countBy(opps, (o) => o.solutionArea), [opps]);
  const pipelineByStage = useMemo(
    () => sumBy(opps, (o) => o.salesStage, (o) => o.estimatedRevenue),
    [opps],
  );

  const completionPct = useMemo(() => {
    if (!filteredMiles.length) return 0;
    const done = filteredMiles.filter((m) => m.milestoneStatus === 'Completed').length;
    return Math.round((done / filteredMiles.length) * 100);
  }, [filteredMiles]);

  // A slice lights up when its dimension has this value selected. If the slice's
  // dimension has no active selection, that whole chart stays fully lit.
  const opacityFor = (dim: Dim, name: string) => {
    const set = isOppDim(dim) ? selected.opp.get(dim) : selected.mile.get(dim);
    if (!set || set.size === 0) return 1;
    return set.has(name) ? 1 : 0.28;
  };

  const filteredPipeline = useMemo(
    () => filteredOpps.reduce((sum, o) => sum + (o.estimatedRevenue ?? 0), 0),
    [filteredOpps],
  );

  const kpis = [
    { label: 'Opportunities', value: filteredOpps.length },
    { label: 'Pipeline Value', value: formatCurrency(filteredPipeline) },
    { label: 'Milestones', value: filteredMiles.length },
    { label: 'At Risk', value: filteredMiles.filter((m) => m.milestoneStatus === 'At Risk').length },
    { label: 'Blocked', value: filteredMiles.filter((m) => m.milestoneStatus === 'Blocked').length },
    { label: 'Pending Approvals', value: summary?.pendingApprovals ?? 0 },
  ];

  return (
    <div>
      <div className="page-header">
        <h1>Dashboard</h1>
        {filters.length > 0 && (
          <div className="filter-chips">
            {filters.map((f) => (
              <button
                key={`${f.dim}:${f.value}`}
                className="chip filter-chip"
                onClick={() => removeFilter(f.dim, f.value)}
                title={`Remove ${DIM_LABELS[f.dim]} filter`}
              >
                {DIM_LABELS[f.dim]}: {f.value} <span aria-hidden="true">✕</span>
              </button>
            ))}
            {filters.length > 1 && (
              <button className="chip filter-chip clear-all" onClick={() => setFilters([])}>
                Clear all <span aria-hidden="true">✕</span>
              </button>
            )}
          </div>
        )}
      </div>

      {error && <p className="error">{error}</p>}
      {!summary && !error && <p className="muted">Loading metrics…</p>}

      {/* KPI strip — reacts to the active cross-filter */}
      <div className="grid cols-4" style={{ marginBottom: 'var(--sp-6)' }}>
        {kpis.map((c) => (
          <div key={c.label} className="card metric">
            <div className="value">{c.value}</div>
            <div className="label">{c.label}</div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="chart-grid">
        <ChartCard title="Milestones by status" hint="Click a slice to filter">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={byStatus}
                dataKey="value"
                nameKey="name"
                innerRadius={62}
                outerRadius={92}
                paddingAngle={2}
                onClick={(e) => toggle('milestoneStatus', nameOf(e))}
              >
                {byStatus.map((s, i) => (
                  <Cell
                    key={s.name}
                    fill={colorFor(s.name, i)}
                    cursor="pointer"
                    stroke="#fff"
                    strokeWidth={2}
                    opacity={opacityFor('milestoneStatus', s.name)}
                  />
                ))}
                <Label
                  position="center"
                  content={(props) => (
                    <CenterLabel viewBox={props.viewBox} top={filteredMiles.length} bottom={filters.length ? 'filtered' : 'total'} />
                  )}
                />
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Completion" hint={`${completionPct}% of the current view`}>
          <div className="gauge">
            <ResponsiveContainer width="100%" height={260}>
              <RadialBarChart
                innerRadius="72%"
                outerRadius="100%"
                data={[{ name: 'Completed', value: completionPct }]}
                startAngle={90}
                endAngle={-270}
              >
                <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                <RadialBar background dataKey="value" cornerRadius={14} fill="#0e7a0b" />
              </RadialBarChart>
            </ResponsiveContainer>
            <div className="gauge-center">
              <span className="gauge-pct">{completionPct}%</span>
              <span className="gauge-sub">completed</span>
            </div>
          </div>
        </ChartCard>

        <ChartCard title="Milestones by risk impact" hint="Click a bar to filter">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={byRisk} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef1f6" />
              <XAxis dataKey="name" tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
              <Tooltip cursor={{ fill: 'rgba(43,108,255,0.06)' }} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]} onClick={(e) => toggle('riskImpact', nameOf(e))}>
                {byRisk.map((s, i) => (
                  <Cell
                    key={s.name}
                    fill={colorFor(s.name, i)}
                    cursor="pointer"
                    opacity={opacityFor('riskImpact', s.name)}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Opportunities by solution area" hint="Click a slice to filter">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={bySolutionArea}
                dataKey="value"
                nameKey="name"
                outerRadius={92}
                paddingAngle={2}
                onClick={(e) => toggle('solutionArea', nameOf(e))}
              >
                {bySolutionArea.map((s, i) => (
                  <Cell
                    key={s.name}
                    fill={colorFor(s.name, i)}
                    cursor="pointer"
                    stroke="#fff"
                    strokeWidth={2}
                    opacity={opacityFor('solutionArea', s.name)}
                  />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Pipeline $ by sales stage" hint="Click a bar to filter" wide>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart layout="vertical" data={pipelineByStage} margin={{ top: 8, right: 24, bottom: 0, left: 24 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#eef1f6" />
              <XAxis type="number" tickFormatter={compactCurrency} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="name" width={120} tickLine={false} axisLine={false} />
              <Tooltip formatter={(v) => formatCurrency(Number(v) || 0)} cursor={{ fill: 'rgba(43,108,255,0.06)' }} />
              <Bar dataKey="value" radius={[0, 6, 6, 0]} onClick={(e) => toggle('salesStage', nameOf(e))}>
                {pipelineByStage.map((s, i) => (
                  <Cell
                    key={s.name}
                    fill={colorFor(s.name, i)}
                    cursor="pointer"
                    opacity={opacityFor('salesStage', s.name)}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Detail table — reflects the active cross-filter */}
      <div className="card" style={{ marginTop: 'var(--sp-6)' }}>
        <div className="chart-head">
          <h3>Milestones{filters.length ? ' · filtered' : ''}</h3>
          <Link to="/milestones" className="muted">View all →</Link>
        </div>
        <p className="muted">Showing {filteredMiles.length} of {miles.length} milestones.</p>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Opportunity</th>
              <th>Status</th>
              <th>Owner</th>
              <th>Est Date</th>
            </tr>
          </thead>
          <tbody>
            {filteredMiles.slice(0, 12).map((m) => (
              <tr key={m.id}>
                <td>{m.milestoneBusinessId}</td>
                <td>
                  <Link to={`/milestones/${m.id}`}>{m.milestoneName}</Link>
                </td>
                <td>{m.opportunity?.opportunityName ?? '—'}</td>
                <td>
                  <span className={`badge ${statusBadgeClass(m.milestoneStatus)}`}>{choiceLabel(m.milestoneStatus)}</span>
                </td>
                <td>{m.owner ?? '—'}</td>
                <td>{formatDate(m.estDate)}</td>
              </tr>
            ))}
            {filteredMiles.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">No milestones match the current filter.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Card wrapper matching the Fluent design system. */
function ChartCard({
  title,
  hint,
  wide,
  children,
}: {
  title: string;
  hint?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`card chart-card${wide ? ' wide' : ''}`}>
      <div className="chart-head">
        <h3>{title}</h3>
        {hint && <span className="chart-hint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/** Two-line centered label for the donut (auto-centers on the pie via viewBox). */
function CenterLabel({ viewBox, top, bottom }: { viewBox?: unknown; top: number | string; bottom: string }) {
  const vb = (viewBox ?? {}) as { cx?: number; cy?: number };
  if (vb.cx == null || vb.cy == null) return null;
  return (
    <>
      <text x={vb.cx} y={vb.cy - 6} textAnchor="middle" fontSize={26} fontWeight={800} fill="#17203a">
        {top}
      </text>
      <text x={vb.cx} y={vb.cy + 16} textAnchor="middle" fontSize={12} fill="#6b7280">
        {bottom}
      </text>
    </>
  );
}
