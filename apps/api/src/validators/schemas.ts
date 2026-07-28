import { z } from 'zod';
import {
  SOLUTION_AREAS,
  SALES_STAGES,
  OPPORTUNITY_STATUSES,
  MILESTONE_STATUSES,
  LOST_TO_COMPETITOR,
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
  lastUpdated: dateish,
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
  statusReason: nstr,
  estDate: dateish,
  fitCharge: z.number().optional().nullable(),
  nonRecurring: z.boolean().optional().nullable(),
  comments: nstr,
  riskDescription: nstr,
  riskImpact: z.enum(RISK_IMPACTS).optional().nullable(),
  mitigationPlan: nstr,
  blockedReason: nstr,
  blockedOwner: nstr,
  blockedSince: dateish,
  expectedResolutionDate: dateish,
  escalated: z.boolean().optional().nullable(),
  competitorName: nstr,
  azureCapacityType: z.enum(AZURE_CAPACITY_TYPES).optional().nullable(),
  preferredAzureRegion: z.enum(PREFERRED_AZURE_REGIONS).optional().nullable(),
  owner: nstr,
  createdBy: nstr,
  lastUpdated: dateish,
});
export const updateMilestoneSchema = createMilestoneSchema.partial().omit({ opportunityName: true });

// ---- Status history ----
export const createStatusHistorySchema = z.object({
  milestoneBusinessId: z.string().min(1), // connect target
  newStatus: z.enum(MILESTONE_STATUSES),
  oldStatus: z.enum(MILESTONE_STATUSES).optional().nullable(),
  changedBy: z.string().min(1),
  reason: nstr,
  // Lets the "Lost To Competitor" pop-up record the competitor in the same
  // request when the milestone has none yet (see statusHistoryService.create).
  competitorName: nstr,
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

// ---- Deal team members ----
export const createDealTeamMemberSchema = z.object({
  dealTeamMemberBusinessId: z.string().optional(),
  opportunityName: z.string().min(1),
  personName: z.string().min(1),
  role: z.string().min(1),
  teamArea: nstr,
  addedDate: dateish,
  active: z.boolean().optional().nullable(),
  handoffRequired: z.boolean().optional().nullable(),
  handoffNotes: nstr,
});
export const updateDealTeamMemberSchema = createDealTeamMemberSchema.partial().omit({
  dealTeamMemberBusinessId: true,
  opportunityName: true,
});

// ---- Approval requests ----
/**
 * A deferred action attached to an approval request. Agents never mutate data or
 * send messages directly — they submit one of these, and the API executes it
 * ONLY when a human approves the request (see approvalRequestsService.decide).
 */
export const pendingActionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('CreateMilestone'),
      competitorBlankConfirmed: z.boolean(),
    })
    .merge(createMilestoneSchema.omit({ milestoneBusinessId: true, createdBy: true })),
  // Creating an opportunity is a business-changing action, so it is gated exactly
  // like the others: the agent submits this and the API creates the opportunity
  // ONLY when a human approves the request. Business id is omitted so the agent
  // never chooses one (the service generates it on approval).
  z
    .object({ kind: z.literal('CreateOpportunity') })
    .merge(createOpportunitySchema.omit({ opportunityBusinessId: true })),
  z.object({
    kind: z.literal('SendOutlookMail'),
    to: z.string().email(),
    subject: z.string().min(1),
    body: z.string().min(1),
  }),
  z.object({
    kind: z.literal('NotifyTeams'),
    message: z.string().min(1),
    to: z.string().email().optional(),
  }),
  // Full-parity updates: the agent may propose changes to EVERY editable field on
  // the three business entities (composed from the update schemas below so this
  // stays in sync automatically). `createdBy` is omitted — it is stamped with the
  // agent name by executeAction, never chosen by the agent.
  z
    .object({ kind: z.literal('UpdateMilestone'), milestoneId: z.string().min(1) })
    .merge(updateMilestoneSchema.omit({ createdBy: true })),
  z
    .object({ kind: z.literal('UpdateOpportunity'), opportunityId: z.string().min(1) })
    .merge(updateOpportunitySchema),
  z
    .object({ kind: z.literal('UpdateDealTeamMember'), dealTeamMemberId: z.string().min(1) })
    .merge(updateDealTeamMemberSchema),
  z.object({
    kind: z.literal('DeleteMilestone'),
    milestoneId: z.string().min(1),
  }),
]).superRefine((action, ctx) => {
  if (
    action.kind === 'CreateMilestone' &&
    !action.competitorName?.trim() &&
    !action.competitorBlankConfirmed
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['competitorBlankConfirmed'],
      message: 'Ask the user to confirm before leaving competitor empty.',
    });
  }
  // A competitor is mandatory (never just "confirmed blank") whenever the
  // milestone is being set to "Lost To Competitor". UpdateMilestone can't be
  // fully checked here because the existing milestone may already carry a
  // competitor — that case is enforced in approvalRequestsService.create and in
  // milestonesService.update.
  if (
    action.kind === 'CreateMilestone' &&
    action.milestoneStatus === LOST_TO_COMPETITOR &&
    !action.competitorName?.trim()
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['competitorName'],
      message: 'A competitor is required to create a milestone as "Lost To Competitor".',
    });
  }
});
export type PendingAction = z.infer<typeof pendingActionSchema>;

export const createApprovalSchema = z.object({
  approvalRequestBusinessId: z.string().optional(),
  requestName: z.string().min(1),
  opportunityName: nstr,
  relatedRecommendationBusinessId: nstr,
  relatedMilestoneBusinessId: nstr,
  requestStatus: z.enum(REQUEST_STATUSES).optional().nullable(),
  approvalStatus: z.enum(APPROVAL_STATUSES).optional().nullable(),
  requestedBy: nstr,
  /** Optional deferred action executed on approval (create/update/delete, email, or Teams). */
  action: pendingActionSchema.optional(),
}).superRefine((approval, ctx) => {
  if (approval.relatedRecommendationBusinessId && !approval.action) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['action'],
      message: 'A recommendation-backed approval must include its complete deferred action.',
    });
  }
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
  /**
   * The reviewer's acknowledgement (from the Approvals-tab pop-up) that they
   * understand an executive-summary email will be sent to their manager when
   * approving an action that moves a milestone to "Lost To Competitor". This
   * flag is the human-in-the-loop confirm that authorises the send.
   */
  acknowledgeManagerEmail: z.boolean().optional(),
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

// ---- Chat (assistant) ----
export const chatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1),
      }),
    )
    .min(1),
  // The in-app engine is disabled; the Foundry hosted agent is the only engine.
  engine: z.enum(['in-app', 'foundry']).optional().default('foundry'),
});

// ---- Universal search ----
/**
 * Query params for GET /api/search — the "look up ANY field" capability.
 * `q` is matched (case-insensitive substring) against every scalar field of the
 * global business records. `entity` optionally restricts to one record type and
 * `field` optionally restricts matching to a single field name.
 */
export const searchSchema = z.object({
  q: z.string().trim().min(1, 'Provide a search term (q).'),
  entity: z.string().trim().min(1).optional(),
  field: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

// ---- Microsoft Graph (send as user) ----
export const sendMailSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1),
  body: z.string().min(1),
  confirm: z.boolean().optional(),
});

export const notifyTeamsSchema = z.object({
  message: z.string().min(1),
  to: z.string().email().optional(),
  confirm: z.boolean().optional(),
});

/**
 * Body for POST /opportunities/:id/announce — the human-consented "notify the
 * team of this new opportunity" Teams broadcast. `confirm: true` is the explicit
 * go-ahead from the inline consent modal that authorises the send.
 */
export const announceOpportunitySchema = z.object({
  confirm: z.boolean().optional(),
});
