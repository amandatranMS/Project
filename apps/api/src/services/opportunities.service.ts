import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/httpError.js';
import { genId } from '../lib/ids.js';
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
};
