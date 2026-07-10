import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/httpError.js';
import { genId } from '../lib/ids.js';
import type { z } from 'zod';
import type { createStatusHistorySchema } from '../validators/schemas.js';

type CreateInput = z.infer<typeof createStatusHistorySchema>;

export const statusHistoryService = {
  list(where: { milestoneId?: string }) {
    return prisma.milestoneStatusHistory.findMany({
      where,
      orderBy: { statusDate: 'desc' },
      take: 300,
    });
  },

  /** Adds a history row and moves the milestone to the new status (transaction). */
  async create(input: CreateInput) {
    const milestone = await prisma.opportunityMilestone.findUnique({
      where: { milestoneBusinessId: input.milestoneBusinessId },
    });
    if (!milestone) throw new HttpError(400, `Milestone "${input.milestoneBusinessId}" was not found.`);

    const [, history] = await prisma.$transaction([
      prisma.opportunityMilestone.update({
        where: { id: milestone.id },
        data: { milestoneStatus: input.newStatus },
      }),
      prisma.milestoneStatusHistory.create({
        data: {
          statusHistoryBusinessId: genId('SH'),
          milestone: { connect: { id: milestone.id } },
          opportunity: { connect: { id: milestone.opportunityId } },
          oldStatus: input.oldStatus ?? milestone.milestoneStatus,
          newStatus: input.newStatus,
          statusDate: new Date(),
          reason: input.reason,
          changedBy: input.changedBy,
        },
      }),
    ]);
    return history;
  },
};
