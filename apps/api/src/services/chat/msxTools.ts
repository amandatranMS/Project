import {
  MILESTONE_STATUSES,
  MILESTONE_CATEGORIES,
  SALES_STAGES,
  OPPORTUNITY_STATUSES,
} from '@msx/shared';
import { milestonesService } from '../milestones.service.js';
import { dashboardService } from '../dashboard.service.js';
import { opportunitiesService } from '../opportunities.service.js';
import { searchService } from '../search.service.js';
import {
  createMilestoneSchema,
  updateMilestoneSchema,
  createOpportunitySchema,
} from '../../validators/schemas.js';
import type { Tool } from './toolLoop.js';

/**
 * Adapter layer between model function calls and application services.
 * Tool schemas constrain model arguments; Zod performs the final runtime check,
 * and trimmed return shapes keep irrelevant database fields out of prompts.
 */
const s = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function trimMilestone(m: any) {
  return {
    id: m.id,
    milestoneBusinessId: m.milestoneBusinessId,
    milestoneName: m.milestoneName,
    milestoneStatus: m.milestoneStatus,
    milestoneCategory: m.milestoneCategory,
    owner: m.owner,
    riskImpact: m.riskImpact,
    opportunity: m.opportunity?.opportunityName,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function trimOpportunity(o: any) {
  return {
    id: o.id,
    opportunityBusinessId: o.opportunityBusinessId,
    opportunityName: o.opportunityName,
    customerName: o.customerName,
    salesStage: o.salesStage,
    status: o.status,
    milestones: o._count?.milestones,
  };
}

// ---- Milestone tools -----------------------------------------------------
export const milestoneTools: Tool[] = [
  {
    name: 'list_milestones',
    description: 'List milestones, optionally filtered by status.',
    parameters: {
      type: 'object',
      properties: { milestoneStatus: { type: 'string', enum: [...MILESTONE_STATUSES] } },
    },
    run: async (a) => {
      const rows = await milestonesService.list({ milestoneStatus: s(a.milestoneStatus) });
      return rows.map(trimMilestone);
    },
  },
  {
    name: 'get_milestone',
    description: "Get one milestone's full detail by its id.",
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    run: (a) => milestonesService.get(String(a.id)),
  },
  {
    name: 'create_milestone',
    description: 'Create a milestone under an existing opportunity (by opportunity name).',
    parameters: {
      type: 'object',
      properties: {
        milestoneName: { type: 'string' },
        opportunityName: { type: 'string', description: 'Must match an existing opportunity name.' },
        milestoneStatus: { type: 'string', enum: [...MILESTONE_STATUSES] },
        milestoneCategory: { type: 'string', enum: [...MILESTONE_CATEGORIES] },
        owner: { type: 'string' },
        riskDescription: { type: 'string' },
      },
      required: ['milestoneName', 'opportunityName'],
    },
    run: async (a) => {
      const input = createMilestoneSchema.parse(a);
      return trimMilestone(await milestonesService.create(input));
    },
  },
  {
    name: 'update_milestone',
    description: 'Update fields on an existing milestone by id.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        milestoneName: { type: 'string' },
        milestoneStatus: { type: 'string', enum: [...MILESTONE_STATUSES] },
        milestoneCategory: { type: 'string', enum: [...MILESTONE_CATEGORIES] },
        owner: { type: 'string' },
      },
      required: ['id'],
    },
    run: async (a) => {
      const { id, ...rest } = a;
      const input = updateMilestoneSchema.parse(rest);
      return trimMilestone(await milestonesService.update(String(id), input));
    },
  },
  {
    name: 'delete_milestone',
    description: 'Delete a milestone by id (its status history is also removed).',
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    run: (a) => milestonesService.remove(String(a.id)),
  },
];

// ---- Dashboard tools -----------------------------------------------------
export const dashboardTools: Tool[] = [
  {
    name: 'get_dashboard_summary',
    description:
      'Get aggregate metrics: active opportunities, total milestones, at-risk, blocked, pending approvals, pipeline value.',
    parameters: { type: 'object', properties: {} },
    run: () => dashboardService.summary(),
  },
];

// ---- Opportunity tools ---------------------------------------------------
export const opportunityTools: Tool[] = [
  {
    name: 'list_opportunities',
    description: 'List opportunities, optionally filtered by status or sales stage.',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: [...OPPORTUNITY_STATUSES] },
        salesStage: { type: 'string', enum: [...SALES_STAGES] },
      },
    },
    run: async (a) => {
      const rows = await opportunitiesService.list({ status: s(a.status), salesStage: s(a.salesStage) });
      return rows.map(trimOpportunity);
    },
  },
  {
    name: 'get_opportunity',
    description: "Get one opportunity's detail (includes its milestones) by id.",
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    run: (a) => opportunitiesService.get(String(a.id)),
  },
  {
    name: 'create_opportunity',
    description: 'Create a new opportunity.',
    parameters: {
      type: 'object',
      properties: {
        opportunityName: { type: 'string' },
        customerName: { type: 'string' },
        salesStage: { type: 'string', enum: [...SALES_STAGES] },
        status: { type: 'string', enum: [...OPPORTUNITY_STATUSES] },
      },
      required: ['opportunityName'],
    },
    run: async (a) => {
      const input = createOpportunitySchema.parse(a);
      // The in-app assistant IS the agent, so a create here is an agent action:
      // pass viaAgent=true to queue the approval-gated Teams broadcast (Path B).
      return trimOpportunity(await opportunitiesService.create(input, { kind: 'service' }, true));
    },
  },
];

// ---- Search tools --------------------------------------------------------
const toLimit = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(200, Math.trunc(n)) : undefined;
};

export const searchTools: Tool[] = [
  {
    name: 'search_records',
    description:
      'Look up records by ANY field value and return the FULL matching records. Matches the ' +
      'query case-insensitively as a substring across every field (ids, names, tpid, customer, ' +
      'industry, sales stage, owners/AE/SE, competitor, region, dates, amounts, flags, free text) ' +
      'of the global business records (opportunities, milestones, status history, recommendations, ' +
      'notes, deal team members, notifications, run logs, dashboard snapshots). Use this to find a ' +
      'record when you do not have its OPP-/MS- id (e.g. a TPID like TPID-1001, a customer, a ' +
      'person, a competitor). Always try it before saying a record does not exist.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The value to search for (matched across every field).' },
        entity: {
          type: 'string',
          enum: searchService.entityKeys(),
          description: 'Optional record type to restrict to. Omit to search all.',
        },
        field: {
          type: 'string',
          description: 'Optional single field name to match on (e.g. tpid, customerName, aeOwner, competitorName).',
        },
        limit: { type: 'number', description: 'Optional max records per entity (default 25).' },
      },
      required: ['query'],
    },
    run: (a) =>
      searchService.search(String(a.query), {
        entity: s(a.entity),
        field: s(a.field),
        limit: toLimit(a.limit),
      }),
  },
];
