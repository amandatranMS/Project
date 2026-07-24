import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/httpError.js';
import { genId } from '../lib/ids.js';
import { connectOpportunity, connectMilestone, connectRecommendation } from '../lib/connect.js';
import { recordAgentAction } from '../lib/audit.js';
import type { AuthUser } from '../lib/entraAuth.js';
import { currentOwnerId, ownerScopeWhere } from '../lib/requestContext.js';
import { graphService } from './graph.service.js';
import { milestonesService } from './milestones.service.js';
import { opportunitiesService } from './opportunities.service.js';
import { dealTeamMembersService } from './dealTeamMembers.service.js';
import type { z } from 'zod';
import type {
  createApprovalSchema,
  updateApprovalSchema,
  approvalDecisionSchema,
  PendingAction,
} from '../validators/schemas.js';
import { pendingActionSchema } from '../validators/schemas.js';

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
    const parsed = pendingActionSchema.safeParse(JSON.parse(errorMessage.slice(ACTION_TAG.length)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Detects a legacy "send" approval (email/Teams) whose title looks like a send
 * request but that carries NO stored action payload. The real message body was
 * never captured on these rows, so we must never fabricate content and deliver
 * it to real people — approving one fails with a clear, actionable error.
 */
function legacySendKind(name?: string | null): 'email' | 'teams' | null {
  const n = name?.trim();
  if (!n) return null;
  if (/^Send email to\s+[^:]+:\s*".*"$/i.test(n)) return 'email';
  if (/^Post Teams message(?:\s+to\s+.+)?$/i.test(n)) return 'teams';
  return null;
}

function summarizeAction(action: PendingAction): string {
  switch (action.kind) {
    case 'CreateMilestone':
      return `Create milestone "${action.milestoneName}"`;
    case 'SendOutlookMail':
      return `Send email to ${action.to} — "${action.subject}"`;
    case 'NotifyTeams':
      return `Post Teams message${action.to ? ` to ${action.to}` : ''}`;
    case 'UpdateMilestone':
      return `Update milestone ${action.milestoneId}`;
    case 'UpdateOpportunity':
      return `Update opportunity ${action.opportunityId}`;
    case 'UpdateDealTeamMember':
      return `Update deal team member ${action.dealTeamMemberId}`;
    case 'DeleteMilestone':
      return `Delete milestone ${action.milestoneId}`;
  }
}

/** Execute a deferred action after a human approves it. Underlying services audit their own writes. */
async function executeAction(
  action: PendingAction,
  actor: AuthUser,
  agentName: string,
  acknowledgeManagerEmail?: boolean,
): Promise<unknown> {
  switch (action.kind) {
    case 'CreateMilestone': {
      const { kind, competitorBlankConfirmed, ...fields } = action;
      return milestonesService.create({ ...fields, createdBy: agentName });
    }
    case 'SendOutlookMail':
      return graphService.sendMail(actor, {
        to: action.to,
        subject: action.subject,
        body: action.body,
        confirm: true,
      });
    case 'NotifyTeams':
      return graphService.notifyTeams(actor, { message: action.message, to: action.to, confirm: true });
    case 'UpdateMilestone': {
      // Pass through every proposed milestone field; stamp the agent as author.
      // The approver acts as the seller, so a transition to Lost To Competitor
      // resolves THEIR manager for the email (gated by the ack from the pop-up).
      const { kind, milestoneId, ...fields } = action;
      return milestonesService.update(
        milestoneId,
        { ...fields, createdBy: agentName },
        { user: actor, changedBy: actor.name ?? agentName, acknowledgeManagerEmail },
      );
    }
    case 'UpdateOpportunity': {
      const { kind, opportunityId, ...fields } = action;
      return opportunitiesService.update(opportunityId, fields, agentName);
    }
    case 'UpdateDealTeamMember': {
      const { kind, dealTeamMemberId, ...fields } = action;
      return dealTeamMembersService.update(dealTeamMemberId, fields, agentName);
    }
    case 'DeleteMilestone':
      return milestonesService.remove(action.milestoneId);
    default:
      throw new HttpError(400, 'This approval contains an unsupported action and was not executed.');
  }
}

const detailInclude = {
  opportunity: { select: { opportunityName: true } },
  relatedRecommendation: true,
  relatedMilestone: { select: { milestoneBusinessId: true, milestoneName: true } },
} as const;

/**
 * Sanitized view of an approval row for the API/UI. Replaces the raw encoded
 * `errorMessage` action blob with a readable summary. CreateMilestone fields
 * are safe mock business data and are exposed for human review; message bodies
 * and other deferred action payloads remain hidden.
 */
function toPublic<T extends { errorMessage?: string | null }>(row: T) {
  const action = decodeAction(row.errorMessage);
  if (!action) return { ...row, pendingAction: null };
  const pendingAction: {
    kind: string;
    milestoneStatus?: string | null;
    milestoneFields?: Omit<Extract<PendingAction, { kind: 'CreateMilestone' }>, 'kind' | 'competitorBlankConfirmed'>;
  } = { kind: action.kind };
  if (action.kind === 'UpdateMilestone') pendingAction.milestoneStatus = action.milestoneStatus ?? null;
  if (action.kind === 'CreateMilestone') {
    const { kind: _kind, competitorBlankConfirmed: _competitorBlankConfirmed, ...milestoneFields } = action;
    pendingAction.milestoneFields = milestoneFields;
  }
  return { ...row, errorMessage: summarizeAction(action), pendingAction };
}

export const approvalRequestsService = {
  async list(where: { approvalStatus?: string }, user?: AuthUser) {
    const scope = ownerScopeWhere(user);
    const rows = await prisma.approvalRequest.findMany({
      where: scope ? { AND: [where, scope] } : where,
      orderBy: { approvalRequestBusinessId: 'asc' },
      include: detailInclude,
      omit: { ownerId: true },
    });
    return rows.map(toPublic);
  },

  async get(id: string) {
    const row = await prisma.approvalRequest.findUnique({
      where: { id },
      include: detailInclude,
      omit: { ownerId: true },
    });
    return row ? toPublic(row) : null;
  },

  async create(input: CreateInput) {
    const { approvalRequestBusinessId, opportunityName, relatedRecommendationBusinessId, relatedMilestoneBusinessId, action, ...rest } = input;
    const row = await prisma.approvalRequest.create({
      data: {
        ...rest,
        approvalRequestBusinessId: approvalRequestBusinessId || genId('APR'),
        approvalStatus: rest.approvalStatus ?? 'Pending',
        // An action-backed request is always Submitted (awaiting a human); plain ones default to Draft.
        requestStatus: action ? 'Submitted' : (rest.requestStatus ?? 'Draft'),
        errorMessage: action ? encodeAction(action) : undefined,
        // Stamp the signed-in user as owner (per-user Approvals scoping). Null for
        // the agent/service principal — back-stamped by chatService after the turn.
        ownerId: currentOwnerId(),
        opportunity: connectOpportunity(opportunityName),
        relatedRecommendation: connectRecommendation(relatedRecommendationBusinessId),
        relatedMilestone: connectMilestone(relatedMilestoneBusinessId),
      },
      include: detailInclude,
      omit: { ownerId: true },
    });
    return toPublic(row);
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
    if (approval.errorMessage?.startsWith(ACTION_TAG) && !pendingAction) {
      throw new HttpError(422, 'This approval has an invalid saved action and was not executed. Please recreate the request.');
    }

    if (decision !== 'Approved') {
      // Preserve the encoded action when it may still be approved later.
      const keepAction = pendingAction && decision === 'Needs Changes';
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

    // Approved + a deferred action attached → execute it (create / send / update / delete).
    // The stored payload is sent verbatim — the exact body the agent drafted.
    if (pendingAction) {
      const result = await executeAction(
        pendingAction,
        actor ?? { kind: 'service' },
        agentName,
        input.acknowledgeManagerEmail,
      );
      if (result === undefined) {
        throw new HttpError(500, 'The approval action returned no result and was not marked complete.');
      }
      const createdMilestone = pendingAction.kind === 'CreateMilestone'
        ? result as Awaited<ReturnType<typeof milestonesService.create>>
        : null;
      const updated = await prisma.approvalRequest.update({
        where: { id },
        data: {
          approvalStatus: 'Approved',
          requestStatus: 'Completed',
          approvedBy: input.reviewedBy,
          approvedOn: new Date(),
          mockWritebackStatus: 'Completed',
          errorMessage: approval.errorMessage,
          relatedMilestoneId: createdMilestone?.id,
        },
      });
      if (createdMilestone && approval.relatedRecommendationId) {
        await prisma.aiMilestoneRecommendation.update({
          where: { id: approval.relatedRecommendationId },
          data: { reviewStatus: 'Approved', readyForMockCreation: true },
        });
      }
      await recordAgentAction({
        agentName,
        actionType: pendingAction.kind,
        actionName: 'Executed after approval',
        actor: input.reviewedBy,
        opportunityId: approval.opportunityId,
        relatedMilestoneId: createdMilestone?.id,
        relatedRecommendationId: approval.relatedRecommendationId,
        securityEvent: pendingAction.kind === 'SendOutlookMail' || pendingAction.kind === 'NotifyTeams',
        outputSummary: `Approved ${approval.approvalRequestBusinessId} → ${summarizeAction(pendingAction)}`,
      });
      return {
        approval: updated,
        action: pendingAction.kind,
        result,
        ...(createdMilestone ? { milestone: createdMilestone } : {}),
      };
    }

    // Approved but no stored action. If the title looks like a legacy send
    // request, its real drafted message was never captured — refuse rather than
    // send fabricated placeholder content to real people.
    const legacyKind = legacySendKind(approval.requestName);
    if (legacyKind) {
      throw new HttpError(
        422,
        `This ${legacyKind === 'email' ? 'email' : 'Teams'} request has no saved message content, so there is nothing to send. Recreate it through the assistant (draft, then confirm) so the exact drafted message is captured, then approve that request.`,
      );
    }

    // Approved (no action): create the milestone (writeback) from the recommendation.
    if (!approval.opportunityId) {
      throw new HttpError(
        400,
        'Approval has no executable action and no linked opportunity for milestone writeback.',
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
