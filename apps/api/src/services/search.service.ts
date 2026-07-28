import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/httpError.js';

/**
 * Universal, read-only "look up ANY field" search across the GLOBAL business
 * records. A single term is matched (case-insensitive substring) against every
 * scalar column of each record — ids, names, tpid, customer, industry, owners,
 * competitor, region, dates, amounts, flags, free text — plus the immediate
 * parent opportunity/milestone for child rows. Full records are returned so the
 * caller gets "all information" for anything that matched.
 *
 * Scope: the 9 global mock tables. ApprovalRequest and AgentActionAuditLog are
 * deliberately excluded — they are per-user scoped and already have dedicated
 * list endpoints/tools; a global cross-user scan of them would leak other users'
 * activity. This is a read (no data changes, no messages) so it is not approval-
 * gated or audited, exactly like the existing list/get reads.
 *
 * The dataset is tiny mock data, so matching is done in memory after a plain
 * findMany. That keeps it DB-agnostic (works identically on the Postgres and the
 * local SQLite schema, neither needing case-insensitive `contains` support).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

interface EntityDef {
  /** Canonical key used in the response and accepted by ?entity=. */
  key: string;
  /** Human label for the response. */
  label: string;
  /** Accepted ?entity= aliases (case-insensitive), e.g. singular/plural/model. */
  aliases: string[];
  /** Loads all rows with light parent context for display + matching. */
  fetch: () => Promise<Row[]>;
  /** Extra searchable [fieldPath, value] pairs pulled from included relations. */
  extras?: (row: Row) => Array<[string, unknown]>;
}

const parentOpp = { select: { opportunityBusinessId: true, opportunityName: true, customerName: true } } as const;
const parentMilestone = { select: { milestoneBusinessId: true, milestoneName: true } } as const;

/** The searchable global business tables. */
const ENTITIES: EntityDef[] = [
  {
    key: 'opportunity',
    label: 'Opportunity',
    aliases: ['opportunity', 'opportunities', 'opp', 'opps'],
    fetch: () =>
      prisma.opportunity.findMany({
        orderBy: { opportunityBusinessId: 'asc' },
        include: { _count: { select: { milestones: true } } },
      }),
  },
  {
    key: 'milestone',
    label: 'OpportunityMilestone',
    aliases: ['milestone', 'milestones', 'opportunitymilestone', 'opportunitymilestones', 'ms'],
    fetch: () =>
      prisma.opportunityMilestone.findMany({
        orderBy: { milestoneBusinessId: 'asc' },
        include: { opportunity: parentOpp },
      }),
    extras: (m) => [
      ['opportunity.opportunityName', m.opportunity?.opportunityName],
      ['opportunity.opportunityBusinessId', m.opportunity?.opportunityBusinessId],
      ['opportunity.customerName', m.opportunity?.customerName],
    ],
  },
  {
    key: 'statusHistory',
    label: 'MilestoneStatusHistory',
    aliases: ['statushistory', 'status-history', 'statushistories', 'history', 'sh'],
    fetch: () =>
      prisma.milestoneStatusHistory.findMany({
        orderBy: { statusHistoryBusinessId: 'asc' },
        include: { milestone: parentMilestone, opportunity: parentOpp },
      }),
    extras: (h) => [
      ['milestone.milestoneBusinessId', h.milestone?.milestoneBusinessId],
      ['milestone.milestoneName', h.milestone?.milestoneName],
      ['opportunity.opportunityName', h.opportunity?.opportunityName],
    ],
  },
  {
    key: 'recommendation',
    label: 'AiMilestoneRecommendation',
    aliases: ['recommendation', 'recommendations', 'aimilestonerecommendation', 'rec', 'recs'],
    fetch: () =>
      prisma.aiMilestoneRecommendation.findMany({
        orderBy: { recommendationBusinessId: 'asc' },
        include: { opportunity: parentOpp, relatedMilestone: parentMilestone },
      }),
    extras: (r) => [
      ['opportunity.opportunityName', r.opportunity?.opportunityName],
      ['relatedMilestone.milestoneBusinessId', r.relatedMilestone?.milestoneBusinessId],
    ],
  },
  {
    key: 'note',
    label: 'CollaborationNote',
    aliases: ['note', 'notes', 'collaborationnote', 'collaborationnotes', 'cn'],
    fetch: () =>
      prisma.collaborationNote.findMany({
        orderBy: { collaborationNoteBusinessId: 'asc' },
        include: { opportunity: parentOpp, relatedMilestone: parentMilestone },
      }),
    extras: (n) => [
      ['opportunity.opportunityName', n.opportunity?.opportunityName],
      ['relatedMilestone.milestoneBusinessId', n.relatedMilestone?.milestoneBusinessId],
    ],
  },
  {
    key: 'dealTeam',
    label: 'DealTeamMember',
    aliases: ['dealteam', 'deal-team', 'dealteammember', 'dealteammembers', 'dt', 'team'],
    fetch: () =>
      prisma.dealTeamMember.findMany({
        orderBy: { dealTeamMemberBusinessId: 'asc' },
        include: { opportunity: parentOpp },
      }),
    extras: (d) => [
      ['opportunity.opportunityName', d.opportunity?.opportunityName],
      ['opportunity.opportunityBusinessId', d.opportunity?.opportunityBusinessId],
    ],
  },
  {
    key: 'notification',
    label: 'AgentNotification',
    aliases: ['notification', 'notifications', 'agentnotification', 'agentnotifications', 'nt'],
    fetch: () =>
      prisma.agentNotification.findMany({
        orderBy: { notificationBusinessId: 'asc' },
        include: { opportunity: parentOpp, relatedMilestone: parentMilestone },
      }),
    extras: (n) => [
      ['opportunity.opportunityName', n.opportunity?.opportunityName],
      ['relatedMilestone.milestoneBusinessId', n.relatedMilestone?.milestoneBusinessId],
    ],
  },
  {
    key: 'runLog',
    label: 'AgentRunLog',
    aliases: ['runlog', 'run-log', 'runlogs', 'agentrunlog', 'agentrunlogs', 'run', 'runs'],
    fetch: () =>
      prisma.agentRunLog.findMany({
        orderBy: { runName: 'asc' },
        include: { opportunity: parentOpp, relatedMilestone: parentMilestone },
      }),
    extras: (r) => [
      ['opportunity.opportunityName', r.opportunity?.opportunityName],
      ['relatedMilestone.milestoneBusinessId', r.relatedMilestone?.milestoneBusinessId],
    ],
  },
  {
    key: 'snapshot',
    label: 'DashboardMetricSnapshot',
    aliases: ['snapshot', 'snapshots', 'dashboardmetricsnapshot', 'dashboardmetricsnapshots', 'metric', 'metrics'],
    fetch: () => prisma.dashboardMetricSnapshot.findMany({ orderBy: { snapshotName: 'asc' } }),
  },
];

/** Renders a scalar value as the string(s) it should be matched against. */
export function searchableStrings(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (value instanceof Date) {
    const iso = value.toISOString();
    return [iso, iso.slice(0, 10)]; // full ISO + date-only (2026-07-21)
  }
  if (typeof value === 'boolean') return [String(value), value ? 'yes' : 'no'];
  if (typeof value === 'number') return [String(value)];
  if (typeof value === 'string') return value ? [value] : [];
  return [];
}

/** True when `fieldFilter` targets this field path (exact or last segment). */
function fieldMatches(path: string, fieldFilter?: string): boolean {
  if (!fieldFilter) return true;
  const p = path.toLowerCase();
  const f = fieldFilter.toLowerCase();
  return p === f || p.split('.').pop() === f;
}

/**
 * Returns the field paths on `row` whose value contains `qLower`. Own scalar
 * columns (skipping `_count` and relation objects) plus any relation-derived
 * `extras` are considered.
 */
export function matchRow(row: Row, extras: Array<[string, unknown]>, qLower: string, fieldFilter?: string): string[] {
  const pairs: Array<[string, unknown]> = [];
  for (const [key, value] of Object.entries(row)) {
    if (key === '_count') continue;
    // Skip included relation objects (matched via `extras`); keep Date values.
    if (value !== null && typeof value === 'object' && !(value instanceof Date)) continue;
    pairs.push([key, value]);
  }
  for (const pair of extras) pairs.push(pair);

  const matched: string[] = [];
  for (const [path, value] of pairs) {
    if (!fieldMatches(path, fieldFilter)) continue;
    if (searchableStrings(value).some((s) => s.toLowerCase().includes(qLower))) {
      matched.push(path);
    }
  }
  return matched;
}

interface GroupResult {
  entity: string;
  label: string;
  count: number;
  truncated: boolean;
  records: Row[];
}

export interface SearchResponse {
  query: string;
  entity: string;
  field: string | null;
  totalMatches: number;
  results: GroupResult[];
}

const DEFAULT_LIMIT = 25;

/** Resolves an optional ?entity= filter to the entity defs to search. */
function resolveEntities(entity?: string): EntityDef[] {
  if (!entity) return ENTITIES;
  const wanted = entity.trim().toLowerCase();
  const def = ENTITIES.find((e) => e.key.toLowerCase() === wanted || e.aliases.includes(wanted));
  if (!def) {
    throw new HttpError(400, `Unknown entity "${entity}". Valid entities: ${ENTITIES.map((e) => e.key).join(', ')}.`);
  }
  return [def];
}

export const searchService = {
  /** List every searchable entity key (used by tool/UI descriptions). */
  entityKeys(): string[] {
    return ENTITIES.map((e) => e.key);
  },

  /**
   * Search the global business records for `q`, returning full matching records
   * grouped by entity. Each returned record carries `_matchedFields` naming the
   * fields that matched, so callers can explain the hit.
   */
  async search(q: string, opts: { entity?: string; field?: string; limit?: number } = {}): Promise<SearchResponse> {
    const qLower = q.trim().toLowerCase();
    const limit = opts.limit ?? DEFAULT_LIMIT;
    const defs = resolveEntities(opts.entity);

    const fetched = await Promise.all(defs.map(async (def) => ({ def, rows: await def.fetch() })));

    let totalMatches = 0;
    const results: GroupResult[] = [];

    for (const { def, rows } of fetched) {
      const matched: Row[] = [];
      for (const row of rows) {
        const extras = def.extras ? def.extras(row).filter(([, v]) => v != null) : [];
        const fields = matchRow(row, extras, qLower, opts.field);
        if (fields.length) matched.push({ ...row, _matchedFields: fields });
      }
      if (!matched.length) continue;
      totalMatches += matched.length;
      results.push({
        entity: def.key,
        label: def.label,
        count: matched.length,
        truncated: matched.length > limit,
        records: matched.slice(0, limit),
      });
    }

    return {
      query: q,
      entity: opts.entity ?? 'all',
      field: opts.field ?? null,
      totalMatches,
      results,
    };
  },
};
