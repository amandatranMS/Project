import { z } from 'zod';
import {
  SOLUTION_AREAS,
  SALES_STAGES,
  OPPORTUNITY_STATUSES,
  MILESTONE_STATUSES,
  WORKLOADS,
  CUSTOMER_COMMITMENTS,
  DELIVERED_BY,
  MILESTONE_CATEGORIES,
  AZURE_CAPACITY_TYPES,
  PREFERRED_AZURE_REGIONS,
  RISK_IMPACTS,
  PRIORITIES,
  CONFIDENCE_LEVELS,
  REVIEW_STATUSES,
  APPROVAL_STATUSES,
  REQUEST_STATUSES,
  SEVERITIES,
  RUN_TYPES,
  RESULT_STATUSES,
} from '@msx/shared';

// Dates arrive as ISO or "yyyy-mm-dd" strings; kept lenient.
const dateish = z.string().min(1).optional().nullable();
const nstr = z.string().optional().nullable();

// ---- Opportunities ----
export const createOpportunitySchema = z.object({
  opportunityBusinessId: z.string().optional(),
  opportunityName: z.string().min(1),
  tpid: nstr,
  customerName: nstr,
  industry: nstr,
  solutionArea: z.enum(SOLUTION_AREAS).optional().nullable(),
  salesStage: z.enum(SALES_STAGES).optional().nullable(),
  status: z.enum(OPPORTUNITY_STATUSES).optional().nullable(),
  estimatedRevenue: z.number().optional().nullable(),
  closeDate: dateish,
  aeOwner: nstr,
  assignedSE: nstr,
  competitorName: nstr,
  consumptionPhase: nstr,
  businessProblem: nstr,
  nextStep: nstr,
});
export const updateOpportunitySchema = createOpportunitySchema.partial().omit({ opportunityBusinessId: true });

// ---- Milestones ----
export const createMilestoneSchema = z.object({
  milestoneBusinessId: z.string().optional(),
  milestoneName: z.string().min(1),
  opportunityName: z.string().min(1), // connect target
  workload: z.enum(WORKLOADS).optional().nullable(),
  customerCommitment: z.enum(CUSTOMER_COMMITMENTS).optional().nullable(),
  deliveredBy: z.enum(DELIVERED_BY).optional().nullable(),
  partnerName: nstr,
  milestoneCategory: z.enum(MILESTONE_CATEGORIES).optional().nullable(),
  milestoneStatus: z.enum(MILESTONE_STATUSES).optional().nullable(),
  estDate: dateish,
  fitCharge: z.number().optional().nullable(),
  riskDescription: nstr,
  riskImpact: z.enum(RISK_IMPACTS).optional().nullable(),
  mitigationPlan: nstr,
  blockedReason: nstr,
  azureCapacityType: z.enum(AZURE_CAPACITY_TYPES).optional().nullable(),
  preferredAzureRegion: z.enum(PREFERRED_AZURE_REGIONS).optional().nullable(),
  owner: nstr,
  createdBy: nstr,
});
export const updateMilestoneSchema = createMilestoneSchema.partial().omit({ opportunityName: true });

// ---- Status history ----
export const createStatusHistorySchema = z.object({
  milestoneBusinessId: z.string().min(1), // connect target
  newStatus: z.enum(MILESTONE_STATUSES),
  oldStatus: z.enum(MILESTONE_STATUSES).optional().nullable(),
  changedBy: z.string().min(1),
  reason: nstr,
});

// ---- Recommendations ----
export const createRecommendationSchema = z
  .object({
    recommendationBusinessId: z.string().optional(),
    recommendedMilestoneTitle: z.string().min(1),
    opportunityName: nstr,
    relatedMilestoneBusinessId: nstr,
    suggestedDescription: nstr,
    suggestedOwnerRole: nstr,
    suggestedDueDate: dateish,
    priority: z.enum(PRIORITIES).optional().nullable(),
    businessValue: nstr,
    riskOrDependency: nstr,
    confidence: z.enum(CONFIDENCE_LEVELS).optional().nullable(),
    humanReviewRequired: z.boolean().optional(),
    reviewStatus: z.enum(REVIEW_STATUSES).optional().nullable(),
    reviewerNotes: nstr,
    readyForMockCreation: z.boolean().optional(),
    createdByAgent: z.boolean().optional(),
  })
  .refine((d) => d.opportunityName || d.relatedMilestoneBusinessId, {
    message: 'Provide opportunityName or relatedMilestoneBusinessId',
  });
export const updateRecommendationSchema = z.object({
  recommendedMilestoneTitle: nstr,
  suggestedDescription: nstr,
  priority: z.enum(PRIORITIES).optional().nullable(),
  confidence: z.enum(CONFIDENCE_LEVELS).optional().nullable(),
  reviewStatus: z.enum(REVIEW_STATUSES).optional().nullable(),
  reviewerNotes: nstr,
  readyForMockCreation: z.boolean().optional(),
});

// ---- Approval requests ----
export const createApprovalSchema = z.object({
  approvalRequestBusinessId: z.string().optional(),
  requestName: z.string().min(1),
  opportunityName: nstr,
  relatedRecommendationBusinessId: nstr,
  relatedMilestoneBusinessId: nstr,
  requestStatus: z.enum(REQUEST_STATUSES).optional().nullable(),
  approvalStatus: z.enum(APPROVAL_STATUSES).optional().nullable(),
  requestedBy: nstr,
});
export const updateApprovalSchema = z.object({
  requestName: nstr,
  requestStatus: z.enum(REQUEST_STATUSES).optional().nullable(),
  approvalStatus: z.enum(APPROVAL_STATUSES).optional().nullable(),
  approvedBy: nstr,
  errorMessage: nstr,
});
export const approvalDecisionSchema = z.object({
  reviewedBy: z.string().min(1),
  notes: nstr,
  agentName: z.string().optional(),
});

// ---- Collaboration notes ----
export const createNoteSchema = z
  .object({
    collaborationNoteBusinessId: z.string().optional(),
    noteTitle: nstr,
    opportunityName: nstr,
    relatedMilestoneBusinessId: nstr,
    noteType: nstr,
    teamArea: nstr,
    noteSummary: z.string().min(1),
    suggestedAudience: nstr,
    createdBy: nstr,
  })
  .refine((d) => d.opportunityName || d.relatedMilestoneBusinessId, {
    message: 'Provide opportunityName or relatedMilestoneBusinessId',
  });

// ---- Deal team members ----
export const createDealTeamMemberSchema = z.object({
  dealTeamMemberBusinessId: z.string().optional(),
  opportunityName: z.string().min(1),
  personName: z.string().min(1),
  role: z.string().min(1),
  teamArea: nstr,
  active: z.boolean().optional(),
  handoffRequired: z.boolean().optional(),
  handoffNotes: nstr,
});

// ---- Agent notifications ----
export const createNotificationSchema = z.object({
  notificationBusinessId: z.string().optional(),
  opportunityName: nstr,
  relatedMilestoneBusinessId: nstr,
  severity: z.enum(SEVERITIES),
  notifyRole: z.string().min(1),
  message: z.string().min(1),
  status: nstr,
  reasonCode: nstr,
});
export const updateNotificationSchema = z.object({
  status: nstr,
  severity: z.enum(SEVERITIES).optional().nullable(),
});

// ---- Agent run logs ----
export const createRunLogSchema = z.object({
  runName: z.string().optional(),
  agentName: z.string().min(1),
  runType: z.enum(RUN_TYPES),
  status: z.enum(RESULT_STATUSES).optional().nullable(),
  opportunityName: nstr,
  relatedMilestoneBusinessId: nstr,
  numberOfToolCalls: z.number().int().optional().nullable(),
  numberOfRecordsRead: z.number().int().optional().nullable(),
  numberOfRecordsCreated: z.number().int().optional().nullable(),
  numberOfRecommendationsGenerated: z.number().int().optional().nullable(),
  notes: nstr,
});

// ---- Agent action audit logs ----
export const createAuditLogSchema = z.object({
  auditBusinessId: z.string().optional(),
  actionName: z.string().min(1),
  agentName: z.string().min(1),
  actionType: z.string().min(1),
  actor: nstr,
  opportunityName: nstr,
  relatedMilestoneBusinessId: nstr,
  relatedRecommendationBusinessId: nstr,
  inputSummary: nstr,
  outputSummary: nstr,
  securityEvent: z.boolean().optional(),
  result: z.enum(RESULT_STATUSES).optional().nullable(),
});

// ---- Dashboard metric snapshots ----
export const createSnapshotSchema = z.object({
  snapshotName: z.string().optional(),
  totalAgentRuns: z.number().int().optional().nullable(),
  recommendationsGenerated: z.number().int().optional().nullable(),
  recommendationsApproved: z.number().int().optional().nullable(),
  mockMilestonesCreated: z.number().int().optional().nullable(),
  updatesMade: z.number().int().optional().nullable(),
  failedActions: z.number().int().optional().nullable(),
  blockedMilestones: z.number().int().optional().nullable(),
  atRiskMilestones: z.number().int().optional().nullable(),
  lostToCompetitorMilestones: z.number().int().optional().nullable(),
  pendingApprovals: z.number().int().optional().nullable(),
  lastScheduledRunStatus: nstr,
});
