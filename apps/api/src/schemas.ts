import { z } from 'zod';
import {
  CUSTOMER_SEGMENTS,
  DEAL_STAGES,
  OPPORTUNITY_STATUSES,
  PARTNER_TYPES,
  THREAT_LEVELS,
  RISK_LEVELS,
  MILESTONE_TYPES,
  MILESTONE_STATUSES,
  PRIORITIES,
  BLOCKER_STATUSES,
  RECOMMENDATION_TYPES,
  APPROVAL_REQUEST_TYPES,
} from '@msx/shared';

const optionalDate = z
  .string()
  .datetime({ offset: true })
  .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
  .optional()
  .nullable();

// ---- Opportunity ----
export const createOpportunitySchema = z.object({
  name: z.string().min(1),
  accountName: z.string().min(1),
  customerSegment: z.enum(CUSTOMER_SEGMENTS),
  industry: z.string().optional().nullable(),
  dealStage: z.enum(DEAL_STAGES).optional(),
  estimatedValue: z.number().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  probability: z.number().int().min(0).max(100).optional(),
  closeDate: optionalDate,
  owner: z.string().min(1),
  partnerName: z.string().optional().nullable(),
  partnerType: z.enum(PARTNER_TYPES).optional().nullable(),
  competitorName: z.string().optional().nullable(),
  competitorThreatLevel: z.enum(THREAT_LEVELS).optional().nullable(),
  riskLevel: z.enum(RISK_LEVELS).optional(),
  riskNotes: z.string().optional().nullable(),
  status: z.enum(OPPORTUNITY_STATUSES).optional(),
});
export const updateOpportunitySchema = createOpportunitySchema.partial();

// ---- Milestone ----
export const createMilestoneSchema = z.object({
  opportunityId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  milestoneType: z.enum(MILESTONE_TYPES).optional(),
  status: z.enum(MILESTONE_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  owner: z.string().min(1),
  dueDate: optionalDate,
  completedDate: optionalDate,
  blockerDescription: z.string().optional().nullable(),
  blockerStatus: z.enum(BLOCKER_STATUSES).optional(),
  riskAssessment: z.string().optional().nullable(),
  riskScore: z.number().int().min(0).max(100).optional(),
});
export const updateMilestoneSchema = createMilestoneSchema.partial().omit({ opportunityId: true });

export const changeStatusSchema = z.object({
  newStatus: z.enum(MILESTONE_STATUSES),
  changedBy: z.string().min(1),
  changeReason: z.string().optional().nullable(),
});

// ---- Collaboration note ----
export const createNoteSchema = z
  .object({
    opportunityId: z.string().optional().nullable(),
    milestoneId: z.string().optional().nullable(),
    authorName: z.string().min(1),
    authorType: z.enum(['Human', 'Agent']).optional(),
    noteText: z.string().min(1),
    visibility: z.enum(['Team', 'Private']).optional(),
  })
  .refine((d) => d.opportunityId || d.milestoneId, {
    message: 'Provide opportunityId or milestoneId',
  });

// ---- Deal team member ----
export const createDealTeamMemberSchema = z.object({
  opportunityId: z.string().min(1),
  memberName: z.string().min(1),
  email: z.string().email().optional().nullable(),
  role: z.enum(['Solution Engineer', 'Account Executive', 'Specialist', 'Partner', 'Manager']),
  isPrimary: z.boolean().optional(),
});

// ---- Agent: recommendation ----
export const createRecommendationSchema = z
  .object({
    opportunityId: z.string().optional().nullable(),
    milestoneId: z.string().optional().nullable(),
    recommendationType: z.enum(RECOMMENDATION_TYPES),
    title: z.string().min(1),
    recommendationText: z.string().min(1),
    rationale: z.string().optional().nullable(),
    confidenceScore: z.number().min(0).max(1).optional(),
    generatedByAgent: z.string().min(1),
    agentRunId: z.string().optional().nullable(),
  })
  .refine((d) => d.opportunityId || d.milestoneId, {
    message: 'Provide opportunityId or milestoneId',
  });

// ---- Agent: approval request ----
export const createApprovalSchema = z.object({
  recommendationId: z.string().optional().nullable(),
  milestoneId: z.string().optional().nullable(),
  requestType: z.enum(APPROVAL_REQUEST_TYPES),
  requestedBy: z.string().min(1),
  summary: z.string().min(1),
  payload: z.record(z.unknown()),
  agentRunId: z.string().optional().nullable(),
});

export const decideApprovalSchema = z.object({
  decision: z.enum(['Approved', 'Rejected']),
  reviewedBy: z.string().min(1),
  decisionNotes: z.string().optional().nullable(),
});

// ---- Agent: run log ----
export const createRunSchema = z.object({
  agentName: z.string().min(1),
  runType: z.enum(['Recommend', 'Analyze', 'CreateMilestone', 'Other']),
  input: z.record(z.unknown()).optional(),
});

export const completeRunSchema = z.object({
  status: z.enum(['Succeeded', 'Failed']),
  output: z.record(z.unknown()).optional(),
  errorText: z.string().optional().nullable(),
});
