import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/httpError.js';
import { genId } from '../lib/ids.js';
import { connectOpportunity } from '../lib/connect.js';
import { recordAgentAction } from '../lib/audit.js';
import type { z } from 'zod';
import type { createMilestoneSchema, updateMilestoneSchema } from '../validators/schemas.js';

type CreateInput = z.infer<typeof createMilestoneSchema>;
type UpdateInput = z.infer<typeof updateMilestoneSchema>;

export const milestonesService = {
  list(where: { opportunityId?: string; milestoneStatus?: string }) {
    return prisma.opportunityMilestone.findMany({
      where,
      orderBy: { milestoneBusinessId: 'asc' },
      include: { opportunity: { select: { id: true, opportunityName: true, customerName: true } } },
    });
  },

  get(id: string) {
    return prisma.opportunityMilestone.findFirst({
      where: { OR: [{ id }, { milestoneBusinessId: id }] },
      include: {
        opportunity: true,
        statusHistories: { orderBy: { statusDate: 'desc' } },
        recommendations: true,
        approvalRequests: true,
        collaborationNotes: true,
      },
    });
  },

  async create(input: CreateInput) {
    const { opportunityName, milestoneBusinessId, estDate, ...rest } = input;
    const opportunity = await prisma.opportunity.findUnique({ where: { opportunityName } });
    if (!opportunity) throw new HttpError(400, `Opportunity "${opportunityName}" was not found.`);

    const milestone = await prisma.opportunityMilestone.create({
      data: {
        ...rest,
        milestoneBusinessId: milestoneBusinessId || genId('MS'),
        estDate: estDate ? new Date(estDate) : null,
        opportunity: { connect: { opportunityName } },
      },
      include: { opportunity: { select: { id: true, opportunityName: true, customerName: true } } },
    });
    await recordAgentAction({
      agentName: input.createdBy ?? 'system',
      actionType: 'Create',
      actionName: 'Milestone created',
      opportunityId: opportunity.id,
      relatedMilestoneId: milestone.id,
      outputSummary: `Created ${milestone.milestoneBusinessId}`,
    });
    return milestone;
  },

  async update(id: string, input: UpdateInput) {
    const existing = await prisma.opportunityMilestone.findFirst({
      where: { OR: [{ id }, { milestoneBusinessId: id }] },
    });
    if (!existing) throw new HttpError(404, 'Milestone not found.');
    const { estDate, ...rest } = input;
    const milestone = await prisma.opportunityMilestone.update({
      where: { id: existing.id },
      data: { ...rest, estDate: estDate ? new Date(estDate) : undefined },
      include: { opportunity: { select: { id: true, opportunityName: true, customerName: true } } },
    });

    const changedFields = Object.keys(input).filter(
      (k) => (input as Record<string, unknown>)[k] !== undefined,
    );
    await recordAgentAction({
      agentName: input.createdBy ?? 'system',
      actionType: 'Update',
      actionName: 'Milestone updated',
      opportunityId: existing.opportunityId,
      relatedMilestoneId: milestone.id,
      inputSummary: `Updated ${existing.milestoneBusinessId}${
        changedFields.length ? ` (fields: ${changedFields.join(', ')})` : ''
      }`,
    });

    return milestone;
  },

  /** Deletes a milestone (status history cascades; other links are set to null). */
  async remove(id: string) {
    const existing = await prisma.opportunityMilestone.findFirst({
      where: { OR: [{ id }, { milestoneBusinessId: id }] },
    });
    if (!existing) throw new HttpError(404, 'Milestone not found.');

    await prisma.opportunityMilestone.delete({ where: { id: existing.id } });

    await recordAgentAction({
      agentName: 'system',
      actionType: 'Delete',
      actionName: 'Milestone deleted',
      opportunityId: existing.opportunityId,
      inputSummary: `Deleted ${existing.milestoneBusinessId} (${existing.milestoneName})`,
    });

    return { id, milestoneBusinessId: existing.milestoneBusinessId };
  },
};
