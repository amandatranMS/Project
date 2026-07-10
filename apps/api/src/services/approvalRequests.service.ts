import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/httpError.js';
import { genId } from '../lib/ids.js';
import { connectOpportunity, connectMilestone, connectRecommendation } from '../lib/connect.js';
import { recordAgentAction } from '../lib/audit.js';
import type { z } from 'zod';
import type { createApprovalSchema, updateApprovalSchema, approvalDecisionSchema } from '../validators/schemas.js';

type CreateInput = z.infer<typeof createApprovalSchema>;
type UpdateInput = z.infer<typeof updateApprovalSchema>;
type DecisionInput = z.infer<typeof approvalDecisionSchema>;

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
    const { approvalRequestBusinessId, opportunityName, relatedRecommendationBusinessId, relatedMilestoneBusinessId, ...rest } = input;
    return prisma.approvalRequest.create({
      data: {
        ...rest,
        approvalRequestBusinessId: approvalRequestBusinessId || genId('APR'),
        approvalStatus: rest.approvalStatus ?? 'Pending',
        requestStatus: rest.requestStatus ?? 'Draft',
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
   *  - "Approved" performs the mock milestone writeback from the related
   *    recommendation and audits it as CreateMilestone (the governance gate).
   *  - "Rejected" / "Needs Changes" just update statuses.
   * Every decision is written to the audit log.
   */
  async decide(id: string, decision: 'Approved' | 'Rejected' | 'Needs Changes', input: DecisionInput) {
    const approval = await prisma.approvalRequest.findUnique({
      where: { id },
      include: { relatedRecommendation: true },
    });
    if (!approval) throw new HttpError(404, 'Approval request not found.');
    if (approval.approvalStatus === 'Approved') throw new HttpError(409, 'This request was already approved.');

    const agentName = input.agentName ?? 'MilestoneAdvisor';
    const reviewStatus = decision; // review + approval vocab match

    if (decision !== 'Approved') {
      const updated = await prisma.approvalRequest.update({
        where: { id },
        data: {
          approvalStatus: decision,
          requestStatus: decision === 'Rejected' ? 'Completed' : 'Blocked',
          approvedBy: input.reviewedBy,
          approvedOn: new Date(),
          errorMessage: input.notes ?? undefined,
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

    // Approved: create the milestone (writeback) if not linked to an opportunity we cannot resolve.
    if (!approval.opportunityId) throw new HttpError(400, 'Approval has no linked opportunity to create a milestone under.');
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
