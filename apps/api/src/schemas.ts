import { z } from 'zod';

// Dates arrive as ISO strings or yyyy-mm-dd; coerce leniently.
const dateish = z.string().min(1).optional().nullable();

// ---- Opportunity ----
export const createOpportunitySchema = z.object({
  opportunityBusinessId: z.string().min(1),
  opportunityName: z.string().min(1),
  tpid: z.string().optional().nullable(),
  customerName: z.string().optional().nullable(),
  industry: z.string().optional().nullable(),
  solutionArea: z.string().optional().nullable(),
  salesStage: z.string().optional().nullable(),
  status: z.string().optional().nullable(),
  estimatedRevenue: z.number().optional().nullable(),
  closeDate: dateish,
  aeOwner: z.string().optional().nullable(),
  assignedSE: z.string().optional().nullable(),
  competitorName: z.string().optional().nullable(),
  consumptionPhase: z.string().optional().nullable(),
  businessProblem: z.string().optional().nullable(),
  nextStep: z.string().optional().nullable(),
});
export const updateOpportunitySchema = createOpportunitySchema.partial().omit({ opportunityBusinessId: true });

// ---- Milestone ----
export const createMilestoneSchema = z.object({
  milestoneBusinessId: z.string().min(1),
  milestoneName: z.string().min(1),
  opportunityName: z.string().min(1), // lookup target for connect
  workload: z.string().optional().nullable(),
  milestoneCategory: z.string().optional().nullable(),
  milestoneStatus: z.string().optional().nullable(),
  partnerName: z.string().optional().nullable(),
  estDate: dateish,
  fitCharge: z.number().optional().nullable(),
  riskDescription: z.string().optional().nullable(),
  riskImpact: z.string().optional().nullable(),
  mitigationPlan: z.string().optional().nullable(),
  blockedReason: z.string().optional().nullable(),
  owner: z.string().optional().nullable(),
});
export const updateMilestoneSchema = createMilestoneSchema.partial().omit({ opportunityName: true });

export const changeStatusSchema = z.object({
  newStatus: z.string().min(1),
  changedBy: z.string().min(1),
  reason: z.string().optional().nullable(),
});

// ---- Collaboration ----
export const createNoteSchema = z
  .object({
    collaborationNoteBusinessId: z.string().min(1),
    noteTitle: z.string().optional().nullable(),
    opportunityName: z.string().optional().nullable(),
    relatedMilestoneBusinessId: z.string().optional().nullable(),
    noteType: z.string().optional().nullable(),
    teamArea: z.string().optional().nullable(),
    noteSummary: z.string().min(1),
    createdBy: z.string().optional().nullable(),
  })
  .refine((d) => d.opportunityName || d.relatedMilestoneBusinessId, {
    message: 'Provide opportunityName or relatedMilestoneBusinessId',
  });

export const createDealTeamMemberSchema = z.object({
  dealTeamMemberBusinessId: z.string().min(1),
  opportunityName: z.string().min(1),
  personName: z.string().optional().nullable(),
  role: z.string().optional().nullable(),
  teamArea: z.string().optional().nullable(),
  active: z.boolean().optional(),
});

// ---- Agent governance ----
export const decideApprovalSchema = z.object({
  decision: z.enum(['Approved', 'Rejected']),
  reviewedBy: z.string().min(1),
  decisionNotes: z.string().optional().nullable(),
});
