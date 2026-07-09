import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler, HttpError } from '../middleware/errorHandler.js';
import { recordAgentAction } from '../lib/audit.js';
import {
  createRecommendationSchema,
  createApprovalSchema,
  decideApprovalSchema,
  createRunSchema,
  completeRunSchema,
} from '../schemas.js';

/**
 * Agent-facing endpoints.
 *
 * Governance rules enforced here:
 *  - Agents can READ context, CREATE recommendations, and SUBMIT approval requests freely.
 *  - Agents may ONLY create a real milestone record by fulfilling an APPROVED approval request.
 *  - Every agent action is written to the Agent Action Audit Log.
 */
export const agentRouter = Router();

// ---- Read context (safe, read-only) ----
agentRouter.get(
  '/context/:opportunityId',
  asyncHandler(async (req, res) => {
    const { agentName = 'unknown-agent' } = req.query;
    const opportunity = await prisma.opportunity.findUnique({
      where: { id: req.params.opportunityId },
      include: {
        milestones: { include: { statusHistory: true } },
        dealTeamMembers: true,
        collaborationNotes: true,
      },
    });
    if (!opportunity) throw new HttpError(404, 'Opportunity not found');

    await recordAgentAction({
      agentName: String(agentName),
      actionType: 'ReadContext',
      entityType: 'Opportunity',
      entityId: opportunity.id,
      notes: 'Agent read opportunity context.',
    });

    res.json(opportunity);
  }),
);

// ---- Agent run lifecycle ----
agentRouter.post(
  '/runs',
  asyncHandler(async (req, res) => {
    const data = createRunSchema.parse(req.body);
    const run = await prisma.agentRunLog.create({
      data: {
        agentName: data.agentName,
        runType: data.runType,
        status: 'Running',
        inputJson: data.input ? JSON.stringify(data.input) : undefined,
      },
    });
    res.status(201).json(run);
  }),
);

agentRouter.post(
  '/runs/:id/complete',
  asyncHandler(async (req, res) => {
    const data = completeRunSchema.parse(req.body);
    const existing = await prisma.agentRunLog.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new HttpError(404, 'Agent run not found');
    const completedAt = new Date();
    const run = await prisma.agentRunLog.update({
      where: { id: req.params.id },
      data: {
        status: data.status,
        outputJson: data.output ? JSON.stringify(data.output) : undefined,
        errorText: data.errorText ?? undefined,
        completedAt,
        durationMs: completedAt.getTime() - existing.startedAt.getTime(),
      },
    });
    res.json(run);
  }),
);

// ---- Recommendations (advice only, no side effects on business records) ----
agentRouter.get(
  '/recommendations',
  asyncHandler(async (req, res) => {
    const { status, milestoneId, opportunityId } = req.query;
    const recs = await prisma.aiMilestoneRecommendation.findMany({
      where: {
        status: typeof status === 'string' ? status : undefined,
        milestoneId: typeof milestoneId === 'string' ? milestoneId : undefined,
        opportunityId: typeof opportunityId === 'string' ? opportunityId : undefined,
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(recs);
  }),
);

agentRouter.post(
  '/recommendations',
  asyncHandler(async (req, res) => {
    const data = createRecommendationSchema.parse(req.body);
    const rec = await prisma.aiMilestoneRecommendation.create({
      data: {
        opportunityId: data.opportunityId ?? undefined,
        milestoneId: data.milestoneId ?? undefined,
        recommendationType: data.recommendationType,
        title: data.title,
        recommendationText: data.recommendationText,
        rationale: data.rationale ?? undefined,
        confidenceScore: data.confidenceScore ?? 0,
        generatedByAgent: data.generatedByAgent,
        status: 'Proposed',
      },
    });

    await recordAgentAction({
      agentName: data.generatedByAgent,
      actionType: 'CreateRecommendation',
      entityType: 'Recommendation',
      entityId: rec.id,
      agentRunId: data.agentRunId,
      afterState: rec,
    });

    await prisma.agentNotification.create({
      data: {
        recipient: 'Deal Team',
        notificationType: 'Recommendation',
        title: 'New agent recommendation',
        message: rec.title,
        relatedEntityType: 'Recommendation',
        relatedEntityId: rec.id,
      },
    });

    res.status(201).json(rec);
  }),
);

// ---- Approval requests ----
agentRouter.get(
  '/approvals',
  asyncHandler(async (req, res) => {
    const { status } = req.query;
    const approvals = await prisma.approvalRequest.findMany({
      where: { status: typeof status === 'string' ? status : undefined },
      orderBy: { createdAt: 'desc' },
      include: { recommendation: true },
    });
    res.json(approvals);
  }),
);

agentRouter.post(
  '/approvals',
  asyncHandler(async (req, res) => {
    const data = createApprovalSchema.parse(req.body);
    const approval = await prisma.approvalRequest.create({
      data: {
        recommendationId: data.recommendationId ?? undefined,
        milestoneId: data.milestoneId ?? undefined,
        requestType: data.requestType,
        requestedBy: data.requestedBy,
        summary: data.summary,
        payloadJson: JSON.stringify(data.payload),
        status: 'Pending',
      },
    });

    if (data.recommendationId) {
      await prisma.aiMilestoneRecommendation.update({
        where: { id: data.recommendationId },
        data: { status: 'Submitted' },
      });
    }

    await recordAgentAction({
      agentName: data.requestedBy,
      actionType: 'SubmitApproval',
      entityType: 'ApprovalRequest',
      entityId: approval.id,
      approvalRequestId: approval.id,
      agentRunId: data.agentRunId,
      afterState: approval,
      notes: 'Awaiting human approval.',
    });

    await prisma.agentNotification.create({
      data: {
        recipient: 'Deal Team',
        notificationType: 'Approval Needed',
        title: 'Approval needed',
        message: approval.summary,
        relatedEntityType: 'ApprovalRequest',
        relatedEntityId: approval.id,
      },
    });

    res.status(201).json(approval);
  }),
);

// Human decision on an approval request.
agentRouter.post(
  '/approvals/:id/decision',
  asyncHandler(async (req, res) => {
    const { decision, reviewedBy, decisionNotes } = decideApprovalSchema.parse(req.body);
    const existing = await prisma.approvalRequest.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new HttpError(404, 'Approval request not found');
    if (existing.status !== 'Pending') throw new HttpError(409, 'Approval request already decided');

    const approval = await prisma.approvalRequest.update({
      where: { id: req.params.id },
      data: { status: decision, reviewedBy, reviewedAt: new Date(), decisionNotes },
    });

    if (existing.recommendationId) {
      await prisma.aiMilestoneRecommendation.update({
        where: { id: existing.recommendationId },
        data: { status: decision === 'Approved' ? 'Approved' : 'Rejected' },
      });
    }

    await prisma.agentNotification.create({
      data: {
        recipient: existing.requestedBy,
        notificationType: 'Approval Result',
        title: `Approval ${decision.toLowerCase()}`,
        message: approval.summary,
        relatedEntityType: 'ApprovalRequest',
        relatedEntityId: approval.id,
      },
    });

    res.json(approval);
  }),
);

/**
 * Fulfill an APPROVED approval request by creating the real milestone record.
 * This is the ONLY path by which an agent can create a milestone. Attempts to
 * fulfill a non-approved request are blocked and audited as "Denied".
 */
agentRouter.post(
  '/approvals/:id/fulfill',
  asyncHandler(async (req, res) => {
    const agentName = typeof req.body?.agentName === 'string' ? req.body.agentName : 'unknown-agent';
    const approval = await prisma.approvalRequest.findUnique({ where: { id: req.params.id } });
    if (!approval) throw new HttpError(404, 'Approval request not found');

    if (approval.status !== 'Approved') {
      await recordAgentAction({
        agentName,
        actionType: 'Denied',
        entityType: 'ApprovalRequest',
        entityId: approval.id,
        approvalRequestId: approval.id,
        outcome: 'Blocked',
        notes: `Blocked: cannot create milestone from ${approval.status} approval request.`,
      });
      throw new HttpError(403, 'Milestone creation blocked: approval request is not Approved.');
    }

    if (approval.requestType !== 'Create Milestone') {
      throw new HttpError(400, 'This approval request is not a Create Milestone request.');
    }

    const payload = JSON.parse(approval.payloadJson) as {
      opportunityId?: string;
      title?: string;
      description?: string;
      milestoneType?: string;
      priority?: string;
      owner?: string;
      dueDate?: string;
    };
    if (!payload.opportunityId || !payload.title || !payload.owner) {
      throw new HttpError(400, 'Approval payload is missing required fields (opportunityId, title, owner).');
    }

    const milestone = await prisma.opportunityMilestone.create({
      data: {
        opportunityId: payload.opportunityId,
        title: payload.title,
        description: payload.description,
        milestoneType: payload.milestoneType ?? 'Custom',
        priority: payload.priority ?? 'Medium',
        owner: payload.owner,
        dueDate: payload.dueDate ? new Date(payload.dueDate) : null,
        status: 'Not Started',
      },
    });

    if (approval.recommendationId) {
      await prisma.aiMilestoneRecommendation.update({
        where: { id: approval.recommendationId },
        data: { status: 'Applied' },
      });
    }

    await recordAgentAction({
      agentName,
      actionType: 'CreateMilestone',
      entityType: 'Milestone',
      entityId: milestone.id,
      approvalRequestId: approval.id,
      afterState: milestone,
      notes: 'Milestone created after approval.',
    });

    res.status(201).json(milestone);
  }),
);

// ---- Audit log (read-only governance view) ----
agentRouter.get(
  '/audit',
  asyncHandler(async (req, res) => {
    const { agentName } = req.query;
    const logs = await prisma.agentActionAuditLog.findMany({
      where: { agentName: typeof agentName === 'string' ? agentName : undefined },
      orderBy: { performedAt: 'desc' },
      take: 200,
    });
    res.json(logs);
  }),
);

// ---- Agent runs (read-only) ----
agentRouter.get(
  '/runs',
  asyncHandler(async (_req, res) => {
    const runs = await prisma.agentRunLog.findMany({ orderBy: { startedAt: 'desc' }, take: 100 });
    res.json(runs);
  }),
);
