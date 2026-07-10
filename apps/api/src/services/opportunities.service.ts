import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/httpError.js';
import { genId } from '../lib/ids.js';
import { recordAgentAction } from '../lib/audit.js';
import type { z } from 'zod';
import type { createOpportunitySchema, updateOpportunitySchema } from '../validators/schemas.js';

type CreateInput = z.infer<typeof createOpportunitySchema>;
type UpdateInput = z.infer<typeof updateOpportunitySchema>;

const childInclude = {
  milestones: { orderBy: { milestoneBusinessId: 'asc' } },
  statusHistories: { orderBy: { statusDate: 'desc' } },
  recommendations: { orderBy: { recommendationBusinessId: 'asc' } },
  approvalRequests: { orderBy: { approvalRequestBusinessId: 'asc' } },
  collaborationNotes: { orderBy: { createdOn: 'desc' } },
  dealTeamMembers: { orderBy: { dealTeamMemberBusinessId: 'asc' } },
  notifications: { orderBy: { createdDate: 'desc' } },
  runLogs: { orderBy: { runName: 'asc' } },
  auditLogs: { orderBy: { createdAt: 'desc' } },
} as const;

export const opportunitiesService = {
  list(where: { status?: string; salesStage?: string; solutionArea?: string }) {
    return prisma.opportunity.findMany({
      where,
      orderBy: { opportunityBusinessId: 'asc' },
      include: { _count: { select: { milestones: true } } },
    });
  },

  get(id: string) {
    return prisma.opportunity.findUnique({
      where: { id },
      include: {
        milestones: { orderBy: { milestoneBusinessId: 'asc' } },
        dealTeamMembers: true,
        collaborationNotes: { orderBy: { createdOn: 'desc' } },
        recommendations: { orderBy: { recommendationBusinessId: 'asc' } },
      },
    });
  },

  /** Full 360° context: opportunity plus every related record. */
  context(id: string) {
    return prisma.opportunity.findUnique({ where: { id }, include: childInclude });
  },

  async create(input: CreateInput) {
    const { opportunityBusinessId, closeDate, ...rest } = input;
    return prisma.opportunity.create({
      data: {
        ...rest,
        opportunityBusinessId: opportunityBusinessId || genId('OPP'),
        closeDate: closeDate ? new Date(closeDate) : null,
      },
    });
  },

  async update(id: string, input: UpdateInput) {
    const existing = await prisma.opportunity.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Opportunity not found.');
    const { closeDate, ...rest } = input;
    return prisma.opportunity.update({
      where: { id },
      data: { ...rest, closeDate: closeDate ? new Date(closeDate) : undefined },
    });
  },

  /**
   * Deletes an opportunity. Blocks by default when it still has milestones;
   * pass cascade=true to remove the opportunity and all its related records.
   */
  async remove(id: string, cascade: boolean) {
    const existing = await prisma.opportunity.findUnique({
      where: { id },
      include: { _count: { select: { milestones: true } } },
    });
    if (!existing) throw new HttpError(404, 'Opportunity not found.');

    const milestoneCount = existing._count.milestones;
    if (milestoneCount > 0 && !cascade) {
      throw new HttpError(
        409,
        `This opportunity has ${milestoneCount} milestone(s). Remove them first, or confirm a cascade delete to remove the opportunity and all related records.`,
      );
    }

    // The Prisma schema cascades milestones, notes and deal-team members, and
    // sets related recommendations/approvals/notifications/logs to null.
    await prisma.opportunity.delete({ where: { id } });

    await recordAgentAction({
      agentName: 'system',
      actionType: 'Delete',
      actionName: cascade && milestoneCount > 0 ? 'Opportunity deleted (cascade)' : 'Opportunity deleted',
      inputSummary: `Deleted ${existing.opportunityBusinessId} (${existing.opportunityName})`,
      outputSummary:
        milestoneCount > 0
          ? `Also removed ${milestoneCount} milestone(s) and related records`
          : 'No milestones were attached',
    });

    return { id, opportunityBusinessId: existing.opportunityBusinessId, milestonesDeleted: milestoneCount };
  },
};
