import {
  MILESTONE_STATUSES,
  MILESTONE_CATEGORIES,
  SALES_STAGES,
  OPPORTUNITY_STATUSES,
  SOLUTION_AREAS,
  FORECAST_CATEGORIES,
  WORKLOADS,
  CUSTOMER_COMMITMENTS,
  DELIVERED_BY,
  AZURE_CAPACITY_TYPES,
  PREFERRED_AZURE_REGIONS,
  RISK_IMPACTS,
  PRIORITIES,
  CONFIDENCE_LEVELS,
} from '@msx/shared';
import { milestonesService } from '../milestones.service.js';
import { dashboardService } from '../dashboard.service.js';
import { opportunitiesService } from '../opportunities.service.js';
import { recommendationsService } from '../recommendations.service.js';
import { approvalRequestsService } from '../approvalRequests.service.js';
import { searchService } from '../search.service.js';
import {
  updateMilestoneSchema,
  createRecommendationSchema,
  createApprovalSchema,
} from '../../validators/schemas.js';
import type { Tool } from './toolLoop.js';

/**
 * Adapter layer between model function calls and application services.
 * Tool schemas constrain model arguments; Zod performs the final runtime check,
 * and trimmed return shapes keep irrelevant database fields out of prompts.
 */
const s = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const nullableString = (v: unknown) => (typeof v === 'string' ? v : null);

function requireExplicitConfirmation(args: Record<string, unknown>) {
  if (args.userConfirmed !== true) {
    throw new Error('Explicit user confirmation is required. Present the complete editable draft first.');
  }
}

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
    forecastCategory: o.forecastCategory,
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
    description:
      'After the user explicitly confirms a complete displayed draft, record its recommendation and submit the milestone for human approval. Never call while drafting.',
    parameters: {
      type: 'object',
      properties: {
        userConfirmed: { type: 'boolean', description: 'True only after a later user message explicitly confirms the displayed draft.' },
        milestoneName: { type: 'string' },
        opportunityName: { type: 'string', description: 'Must match an existing opportunity name.' },
        workload: { type: ['string', 'null'], enum: [...WORKLOADS, null] },
        customerCommitment: { type: ['string', 'null'], enum: [...CUSTOMER_COMMITMENTS, null] },
        deliveredBy: { type: ['string', 'null'], enum: [...DELIVERED_BY, null] },
        partnerName: { type: ['string', 'null'] },
        milestoneStatus: { type: ['string', 'null'], enum: [...MILESTONE_STATUSES, null] },
        milestoneCategory: { type: ['string', 'null'], enum: [...MILESTONE_CATEGORIES, null] },
        statusReason: { type: ['string', 'null'] },
        estDate: { type: ['string', 'null'] },
        fitCharge: { type: ['number', 'null'] },
        nonRecurring: { type: ['boolean', 'null'] },
        comments: { type: ['string', 'null'] },
        riskDescription: { type: ['string', 'null'] },
        riskImpact: { type: ['string', 'null'], enum: [...RISK_IMPACTS, null] },
        mitigationPlan: { type: ['string', 'null'] },
        blockedReason: { type: ['string', 'null'] },
        blockedOwner: { type: ['string', 'null'] },
        blockedSince: { type: ['string', 'null'] },
        expectedResolutionDate: { type: ['string', 'null'] },
        escalated: { type: ['boolean', 'null'] },
        competitorName: { type: ['string', 'null'] },
        competitorBlankConfirmed: { type: 'boolean' },
        azureCapacityType: { type: ['string', 'null'], enum: [...AZURE_CAPACITY_TYPES, null] },
        preferredAzureRegion: { type: ['string', 'null'], enum: [...PREFERRED_AZURE_REGIONS, null] },
        owner: { type: ['string', 'null'] },
        lastUpdated: { type: ['string', 'null'] },
        priority: { type: ['string', 'null'], enum: [...PRIORITIES, null] },
        confidence: { type: ['string', 'null'], enum: [...CONFIDENCE_LEVELS, null] },
      },
      required: ['userConfirmed', 'milestoneName', 'opportunityName', 'competitorBlankConfirmed'],
    },
    run: async (a) => {
      requireExplicitConfirmation(a);
      const recommendation = await recommendationsService.create(
        createRecommendationSchema.parse({
          recommendedMilestoneTitle: a.milestoneName,
          opportunityName: a.opportunityName,
          suggestedDescription: nullableString(a.comments),
          suggestedOwnerRole: nullableString(a.owner),
          suggestedDueDate: nullableString(a.estDate),
          priority: a.priority ?? null,
          riskOrDependency: nullableString(a.riskDescription) ?? nullableString(a.blockedReason),
          confidence: a.confidence ?? null,
          humanReviewRequired: true,
          reviewStatus: 'Pending',
          readyForMockCreation: false,
          createdByAgent: true,
        }),
      );
      const { userConfirmed: _confirmed, priority: _priority, confidence: _confidence, ...fields } = a;
      const approval = await approvalRequestsService.create(
        createApprovalSchema.parse({
          requestName: `Create milestone: ${String(a.milestoneName)}`,
          opportunityName: a.opportunityName,
          relatedRecommendationBusinessId: recommendation.recommendationBusinessId,
          requestedBy: 'InAppAgent',
          action: { kind: 'CreateMilestone', ...fields },
        }),
      );
      return {
        submittedForApproval: true,
        recommendationBusinessId: recommendation.recommendationBusinessId,
        approvalRequestBusinessId: approval.approvalRequestBusinessId,
        approvalStatus: approval.approvalStatus,
        note: 'Pending human approval. The milestone does not exist until approved.',
      };
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
    description:
      'After the user explicitly confirms a complete displayed draft, submit a new opportunity for human approval. Never call while drafting.',
    parameters: {
      type: 'object',
      properties: {
        userConfirmed: { type: 'boolean', description: 'True only after a later user message explicitly confirms the displayed draft.' },
        opportunityName: { type: 'string' },
        customerName: { type: ['string', 'null'] },
        industry: { type: ['string', 'null'] },
        solutionArea: { type: ['string', 'null'], enum: [...SOLUTION_AREAS, null] },
        salesStage: { type: ['string', 'null'], enum: [...SALES_STAGES, null] },
        status: { type: ['string', 'null'], enum: [...OPPORTUNITY_STATUSES, null] },
        forecastCategory: { type: ['string', 'null'], enum: [...FORECAST_CATEGORIES, null] },
        estimatedRevenue: { type: ['number', 'null'] },
        closeDate: { type: ['string', 'null'] },
        aeOwner: { type: ['string', 'null'] },
        assignedSE: { type: ['string', 'null'] },
        competitorName: { type: ['string', 'null'] },
        consumptionPhase: { type: ['string', 'null'] },
        businessProblem: { type: ['string', 'null'] },
        nextStep: { type: ['string', 'null'] },
        lastUpdated: { type: ['string', 'null'] },
      },
      required: ['userConfirmed', 'opportunityName'],
    },
    run: async (a) => {
      requireExplicitConfirmation(a);
      const { userConfirmed: _confirmed, ...fields } = a;
      const approval = await approvalRequestsService.create(
        createApprovalSchema.parse({
          requestName: `Create opportunity ${String(a.opportunityName)}`,
          requestedBy: 'InAppAgent',
          action: { kind: 'CreateOpportunity', ...fields },
        }),
      );
      return {
        submittedForApproval: true,
        approvalRequestBusinessId: approval.approvalRequestBusinessId,
        approvalStatus: approval.approvalStatus,
        note: 'Pending human approval. The opportunity does not exist until approved.',
      };
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
