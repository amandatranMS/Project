import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/httpError.js';
import { genId } from '../lib/ids.js';
import { assertCompetitorForLostStatus } from '../lib/lostToCompetitor.js';
import { maybeNotifyManager, type MilestoneNotifyContext } from './managerNotifications.service.js';
import type { z } from 'zod';
import type { createStatusHistorySchema } from '../validators/schemas.js';

type CreateInput = z.infer<typeof createStatusHistorySchema>;

/** Keeps a milestone's current status and append-only transition history consistent. */
export const statusHistoryService = {
  /** Return newest transitions, optionally limited to one milestone. */
  list(where: { milestoneId?: string }) {
    return prisma.milestoneStatusHistory.findMany({
      where,
      orderBy: { statusDate: 'desc' },
      take: 300,
    });
  },

  /** Adds a history row and moves the milestone to the new status (transaction). */
  async create(input: CreateInput, ctx?: MilestoneNotifyContext) {
    const milestone = await prisma.opportunityMilestone.findUnique({
      where: { milestoneBusinessId: input.milestoneBusinessId },
    });
    if (!milestone) throw new HttpError(400, `Milestone "${input.milestoneBusinessId}" was not found.`);

    // A competitor supplied here (from the "Lost To Competitor" pop-up) is saved
    // onto the milestone alongside the status change. Guard against moving to
    // "Lost To Competitor" without one, considering any competitor already set.
    const competitorName = input.competitorName?.trim() ? input.competitorName.trim() : undefined;
    const effectiveCompetitor = competitorName ?? milestone.competitorName;
    assertCompetitorForLostStatus(input.newStatus, effectiveCompetitor);

    const [, history] = await prisma.$transaction([
      prisma.opportunityMilestone.update({
        where: { id: milestone.id },
        data: { milestoneStatus: input.newStatus, ...(competitorName ? { competitorName } : {}) },
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

    // Side effect: a real transition INTO "Lost To Competitor" notifies the
    // seller's manager (best-effort; guarded by the human acknowledgement).
    const managerEmail = await maybeNotifyManager(
      milestone.milestoneStatus,
      { id: milestone.id, milestoneStatus: input.newStatus },
      { ...ctx, changedBy: ctx?.changedBy ?? input.changedBy ?? undefined },
    );

    return managerEmail ? { ...history, managerEmail } : history;
  },
};
