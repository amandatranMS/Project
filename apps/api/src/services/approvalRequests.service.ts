import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/httpError.js';
import { genId } from '../lib/ids.js';
import { connectOpportunity, connectMilestone, connectRecommendation } from '../lib/connect.js';
import { recordAgentAction } from '../lib/audit.js';
import type { AuthUser } from '../lib/entraAuth.js';
import { graphService } from './graph.service.js';
import { milestonesService } from './milestones.service.js';
import type { z } from 'zod';
import type {
  createApprovalSchema,
  updateApprovalSchema,
  approvalDecisionSchema,
  PendingAction,
} from '../validators/schemas.js';

type CreateInput = z.infer<typeof createApprovalSchema>;
type UpdateInput = z.infer<typeof updateApprovalSchema>;
type DecisionInput = z.infer<typeof approvalDecisionSchema>;

/**
 * Deferred actions are stashed on the (existing) errorMessage column, tagged so
 * we can tell an encoded action apart from a plain error/note. No schema change.
 */
const ACTION_TAG = 'MSX_ACTION::';

function encodeAction(action: PendingAction): string {
  return ACTION_TAG + JSON.stringify(action);
}

function decodeAction(errorMessage?: string | null): PendingAction | null {
  if (!errorMessage || !errorMessage.startsWith(ACTION_TAG)) return null;
  try {
    return JSON.parse(errorMessage.slice(ACTION_TAG.length)) as PendingAction;
  } catch {
    return null;
  }
}

function summarizeAction(action: PendingAction): string {
  switch (action.kind) {
    case 'SendOutlookMail':
      return `Send email to ${action.to} — "${action.subject}"`;
    case 'NotifyTeams':
      return `Post Teams message${action.to ? ` to ${action.to}` : ''}`;
    case 'UpdateMilestone':
      return `Update milestone ${action.milestoneId}`;
    case 'DeleteMilestone':
      return `Delete milestone ${action.milestoneId}`;
  }
}

/**
 * Backward-compatible parser for legacy approval rows that were created
 * without the encoded action payload and only stored a request title.
 */
function inferLegacyAction(approval: { requestName?: string | null }): PendingAction | null {
  const name = approval.requestName?.trim();
  if (!name) return null;

  // Example legacy title: Send email to user@contoso.com: "Subject"
  const match = /^Send email to\s+([^:]+):\s*"([^"]+)"$/i.exec(name);
  if (!match) return null;

  const to = match[1]?.trim();
  const subject = match[2]?.trim();
  if (!to || !subject) return null;

  return {
    kind: 'SendOutlookMail',
    to,
    subject,
    body: 'Sent by MSX Milestone Assistant after human approval.',
  };
}

/** Execute a deferred action after a human approves it. Underlying services audit their own writes. */
async function executeAction(action: PendingAction, actor: AuthUser, agentName: string): Promise<unknown> {
  switch (action.kind) {
    case 'SendOutlookMail':
      return graphService.sendMail(actor, {
        to: action.to,
        subject: action.subject,
        body: action.body,
        confirm: true,
      });
    case 'NotifyTeams':
      return graphService.notifyTeams(actor, { message: action.message, to: action.to, confirm: true });
    case 'UpdateMilestone':
      return milestonesService.update(action.milestoneId, {
        milestoneName: action.milestoneName,
        milestoneStatus: action.milestoneStatus,
        milestoneCategory: action.milestoneCategory,
        owner: action.owner,
        createdBy: agentName,
      });
    case 'DeleteMilestone':
      return milestonesService.remove(action.milestoneId);
  }
}

const detailInclude = {
  opportunity: { select: { opportunityName: true } },
  relatedRecommendation: true,
  relatedMilestone: { select: { milestoneBusinessId: true, milestoneName: true } },
} as const;

export const approvalRequestsService = {
  list(where: { approvalStatus?: string }) {
    return prisma.approvalRequest.findMany({
      where,
      orderBy: { approvalRequestBusinessId: 'asc' },
      include: detailInclude,
    });
  },

  get(id: string) {
    return prisma.approvalRequest.findUnique({ where: { id }, include: detailInclude });
  },

  async create(input: CreateInput) {
    const { approvalRequestBusinessId, opportunityName, relatedRecommendationBusinessId, relatedMilestoneBusinessId, action, ...rest } = input;
    return prisma.approvalRequest.create({
      data: {
        ...rest,
        approvalRequestBusinessId: approvalRequestBusinessId || genId('APR'),
        approvalStatus: rest.approvalStatus ?? 'Pending',
        // An action-backed request is always Submitted (awaiting a human); plain ones default to Draft.
        requestStatus: action ? 'Submitted' : (rest.requestStatus ?? 'Draft'),
        errorMessage: action ? encodeAction(action) : undefined,
        opportunity: connectOpportunity(opportunityName),
        relatedRecommendation: connectRecommendation(relatedRecommendationBusinessId),
        relatedMilestone: connectMilestone(relatedMilestoneBusinessId),
      },
    });
  },

  async update(id: string, input: UpdateInput) {
    const existing = await prisma.approvalRequest.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Approval request not found.');
    return prisma.approvalRequest.update({ where: { id }, data: input });
  },

  /**
   * Records a human decision.
   *  - "Approved" executes the request's deferred action (send email / notify
   *    Teams / milestone update|delete) when one is attached, OR performs the
   *    mock milestone writeback from the related recommendation. Either way this
   *    is the ONLY place agent-proposed writes/sends actually happen.
   *  - "Rejected" / "Needs Changes" never execute anything.
   * Every decision is written to the audit log.
   */
  async decide(
    id: string,
    decision: 'Approved' | 'Rejected' | 'Needs Changes',
    input: DecisionInput,
    actor?: AuthUser,
  ) {
    const approval = await prisma.approvalRequest.findUnique({
      where: { id },
      include: { relatedRecommendation: true },
    });
    if (!approval) throw new HttpError(404, 'Approval request not found.');
    if (approval.approvalStatus === 'Approved') throw new HttpError(409, 'This request was already approved.');

    const agentName = input.agentName ?? 'MilestoneAdvisor';
    const reviewStatus = decision; // review + approval vocab match
    const pendingAction = decodeAction(approval.errorMessage);
    const effectiveAction = pendingAction ?? inferLegacyAction(approval);

    if (decision !== 'Approved') {
      // Preserve the encoded action when it may still be approved later.
      const keepAction = effectiveAction && decision === 'Needs Changes';
      const updated = await prisma.approvalRequest.update({
        where: { id },
        data: {
          approvalStatus: decision,
          requestStatus: decision === 'Rejected' ? 'Completed' : 'Blocked',
          approvedBy: input.reviewedBy,
          approvedOn: new Date(),
          errorMessage: keepAction ? approval.errorMessage : (input.notes ?? undefined),
        },
      });
      if (approval.relatedRecommendationId) {
        await prisma.aiMilestoneRecommendation.update({
          where: { id: approval.relatedRecommendationId },
          data: { reviewStatus, readyForMockCreation: false },
        });
      }
      await recordAgentAction({
        agentName,
        actionType: decision === 'Rejected' ? 'Denied' : 'Update',
        actionName: `Approval ${decision}`,
        actor: input.reviewedBy,
        opportunityId: approval.opportunityId,
        relatedRecommendationId: approval.relatedRecommendationId,
        result: decision === 'Rejected' ? 'Blocked' : 'Success',
        outputSummary: `${approval.approvalRequestBusinessId} → ${decision}`,
      });
      return updated;
    }

    // Approved + a deferred action attached → execute it (send / update / delete).
    if (effectiveAction) {
      const result = await executeAction(effectiveAction, actor ?? { kind: 'service' }, agentName);
      const updated = await prisma.approvalRequest.update({
        where: { id },
        data: {
          approvalStatus: 'Approved',
          requestStatus: 'Completed',
          approvedBy: input.reviewedBy,
          approvedOn: new Date(),
          mockWritebackStatus: 'Completed',
          errorMessage: `Executed: ${summarizeAction(effectiveAction)}`,
        },
      });
      await recordAgentAction({
        agentName,
        actionType: effectiveAction.kind,
        actionName: 'Executed after approval',
        actor: input.reviewedBy,
        opportunityId: approval.opportunityId,
        securityEvent: effectiveAction.kind === 'SendOutlookMail' || effectiveAction.kind === 'NotifyTeams',
        outputSummary: `Approved ${approval.approvalRequestBusinessId} → ${summarizeAction(effectiveAction)}`,
      });
      return { approval: updated, action: effectiveAction.kind, result };
    }

    // Approved (no action): create the milestone (writeback) from the recommendation.
    if (!approval.opportunityId) {
      throw new HttpError(
        400,
        'Approval request has no executable action and no linked opportunity for milestone writeback.',
      );
    }
    const rec = approval.relatedRecommendation;

    const milestone = await prisma.opportunityMilestone.create({
      data: {
        milestoneBusinessId: genId('MS'),
        milestoneName: rec?.recommendedMilestoneTitle ?? approval.requestName ?? 'Approved milestone',
        opportunity: { connect: { id: approval.opportunityId } },
        milestoneCategory: 'Production',
        milestoneStatus: 'On Track',
        owner: rec?.suggestedOwnerRole ?? 'SE',
        comments: rec?.suggestedDescription ?? undefined,
        estDate: rec?.suggestedDueDate ?? undefined,
        createdBy: agentName,
      },
    });

    const updated = await prisma.approvalRequest.update({
      where: { id },
      data: {
        approvalStatus: 'Approved',
        requestStatus: 'Completed',
        approvedBy: input.reviewedBy,
        approvedOn: new Date(),
        mockWritebackStatus: 'Completed',
        errorMessage: input.notes ?? undefined,
      },
    });
    if (approval.relatedRecommendationId) {
      await prisma.aiMilestoneRecommendation.update({
        where: { id: approval.relatedRecommendationId },
        data: { reviewStatus: 'Approved', readyForMockCreation: true },
      });
    }
    await recordAgentAction({
      agentName,
      actionType: 'CreateMilestone',
      actionName: 'Milestone created after approval',
      actor: input.reviewedBy,
      opportunityId: approval.opportunityId,
      relatedMilestoneId: milestone.id,
      relatedRecommendationId: approval.relatedRecommendationId,
      outputSummary: `Approved ${approval.approvalRequestBusinessId} → created ${milestone.milestoneBusinessId}`,
    });
    return { approval: updated, milestone };
  },
};
