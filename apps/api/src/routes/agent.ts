import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler, HttpError } from '../middleware/errorHandler.js';
import { recordAgentAction } from '../lib/audit.js';
import { decideApprovalSchema } from '../schemas.js';

/**
 * Agent-facing endpoints + governance.
 *
 *  - Agents may READ context and view recommendations/approvals freely.
 *  - A real milestone may only be created by fulfilling an APPROVED approval request
 *    (POST /approvals/:id/fulfill). Fulfilling a non-approved request returns 403
 *    and is audited as "Denied".
 *  - Every agent write path is written to the Agent Action Audit Log.
 */
export const agentRouter = Router();

// ---- Read context (audited) ----
agentRouter.get(
  '/context/:opportunityId',
  asyncHandler(async (req, res) => {
    const agentName = typeof req.query.agentName === 'string' ? req.query.agentName : 'unknown-agent';
    const opportunity = await prisma.opportunity.findUnique({
      where: { id: req.params.opportunityId },
      include: { milestones: true, dealTeamMembers: true, collaborationNotes: true },
    });
    if (!opportunity) throw new HttpError(404, 'Opportunity not found');

    await recordAgentAction({
      agentName,
      actionType: 'Read',
      actionName: 'Read opportunity context',
      opportunityId: opportunity.id,
      inputSummary: `Read context for ${opportunity.opportunityBusinessId}`,
      outputSummary: `${opportunity.milestones.length} milestones`,
    });
    res.json(opportunity);
  }),
);

// ---- Recommendations (read-only) ----
agentRouter.get(
  '/recommendations',
  asyncHandler(async (req, res) => {
    const { reviewStatus, opportunityId } = req.query;
    const recs = await prisma.aiMilestoneRecommendation.findMany({
      where: {
        reviewStatus: typeof reviewStatus === 'string' ? reviewStatus : undefined,
        opportunityId: typeof opportunityId === 'string' ? opportunityId : undefined,
      },
      orderBy: { recommendationBusinessId: 'asc' },
      include: { opportunity: { select: { opportunityName: true } } },
    });
    res.json(recs);
  }),
);

// ---- Approval requests ----
agentRouter.get(
  '/approvals',
  asyncHandler(async (req, res) => {
    const { approvalStatus } = req.query;
    const approvals = await prisma.approvalRequest.findMany({
      where: { approvalStatus: typeof approvalStatus === 'string' ? approvalStatus : undefined },
      orderBy: { approvalRequestBusinessId: 'asc' },
      include: {
        opportunity: { select: { opportunityName: true } },
        relatedRecommendation: true,
        relatedMilestone: { select: { milestoneBusinessId: true, milestoneName: true } },
      },
    });
    res.json(approvals);
  }),
);

// Human decision (approve / reject).
agentRouter.post(
  '/approvals/:id/decision',
  asyncHandler(async (req, res) => {
    const { decision, reviewedBy, decisionNotes } = decideApprovalSchema.parse(req.body);
    const existing = await prisma.approvalRequest.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new HttpError(404, 'Approval request not found');
    if (existing.approvalStatus === 'Approved' || existing.approvalStatus === 'Rejected') {
      throw new HttpError(409, 'Approval request already decided');
    }

    const approval = await prisma.approvalRequest.update({
      where: { id: req.params.id },
      data: {
        approvalStatus: decision,
        requestStatus: 'Reviewed',
        approvedBy: reviewedBy,
        approvedOn: new Date(),
        errorMessage: decisionNotes ?? undefined,
      },
    });

    if (existing.relatedRecommendationId) {
      await prisma.aiMilestoneRecommendation.update({
        where: { id: existing.relatedRecommendationId },
        data: { reviewStatus: decision, readyForMockCreation: decision === 'Approved' },
      });
    }

    await prisma.agentNotification.create({
      data: {
        notificationBusinessId: `NT-RUNTIME-${Date.now()}`,
        opportunityId: existing.opportunityId,
        severity: 'Info',
        notifyRole: 'SE',
        message: `Approval ${decision.toLowerCase()}: ${approval.requestName ?? approval.approvalRequestBusinessId}`,
        status: 'Open',
        createdDate: new Date(),
        reasonCode: 'APPROVAL_DECISION',
      },
    });
    res.json(approval);
  }),
);

/**
 * Create a real milestone from an APPROVED approval request (using its related
 * recommendation). Blocked (403) + audited "Denied" when not Approved.
 */
agentRouter.post(
  '/approvals/:id/fulfill',
  asyncHandler(async (req, res) => {
    const agentName = typeof req.body?.agentName === 'string' ? req.body.agentName : 'unknown-agent';
    const approval = await prisma.approvalRequest.findUnique({
      where: { id: req.params.id },
      include: { relatedRecommendation: true },
    });
    if (!approval) throw new HttpError(404, 'Approval request not found');

    if (approval.approvalStatus !== 'Approved') {
      await recordAgentAction({
        agentName,
        actionType: 'Denied',
        actionName: 'Milestone creation blocked',
        opportunityId: approval.opportunityId ?? undefined,
        relatedRecommendationId: approval.relatedRecommendationId ?? undefined,
        result: 'Blocked',
        outputSummary: `Blocked: approval ${approval.approvalRequestBusinessId} is ${approval.approvalStatus}`,
      });
      throw new HttpError(403, 'Milestone creation blocked: approval request is not Approved.');
    }
    if (!approval.opportunityId) throw new HttpError(400, 'Approval has no linked opportunity.');

    const rec = approval.relatedRecommendation;
    const milestone = await prisma.opportunityMilestone.create({
      data: {
        milestoneBusinessId: `MS-RUNTIME-${Date.now()}`,
        milestoneName: rec?.recommendedMilestoneTitle ?? approval.requestName ?? 'Agent-created milestone',
        opportunity: { connect: { id: approval.opportunityId } },
        milestoneCategory: 'Agent Created',
        milestoneStatus: 'Not Started',
        owner: rec?.suggestedOwnerRole ?? 'SE',
        comments: rec?.suggestedDescription ?? undefined,
        estDate: rec?.suggestedDueDate ?? undefined,
        createdBy: agentName,
      },
    });

    await prisma.approvalRequest.update({
      where: { id: approval.id },
      data: { mockWritebackStatus: 'Completed', requestStatus: 'Fulfilled' },
    });
    if (rec) {
      await prisma.aiMilestoneRecommendation.update({
        where: { id: rec.id },
        data: { reviewStatus: 'Approved', readyForMockCreation: true },
      });
    }

    await recordAgentAction({
      agentName,
      actionType: 'CreateMilestone',
      actionName: 'Milestone created after approval',
      opportunityId: approval.opportunityId,
      relatedMilestoneId: milestone.id,
      relatedRecommendationId: approval.relatedRecommendationId ?? undefined,
      outputSummary: `Created ${milestone.milestoneBusinessId}`,
    });

    res.status(201).json(milestone);
  }),
);

// ---- Runs + audit (read-only) ----
agentRouter.get(
  '/runs',
  asyncHandler(async (_req, res) => {
    const runs = await prisma.agentRunLog.findMany({ orderBy: { runName: 'asc' }, take: 100 });
    res.json(runs);
  }),
);

agentRouter.get(
  '/audit',
  asyncHandler(async (req, res) => {
    const { agentName } = req.query;
    const logs = await prisma.agentActionAuditLog.findMany({
      where: { agentName: typeof agentName === 'string' ? agentName : undefined },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    res.json(logs);
  }),
);
