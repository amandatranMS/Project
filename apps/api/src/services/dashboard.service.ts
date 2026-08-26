import { prisma } from '../lib/prisma.js';
import { genId } from '../lib/ids.js';
import type { AuthUser } from '../lib/entraAuth.js';
import { currentScopeWhere } from '../lib/requestContext.js';
import type { z } from 'zod';
import type { createSnapshotSchema } from '../validators/schemas.js';

type CreateInput = z.infer<typeof createSnapshotSchema>;

/** Computes live dashboard aggregates and stores optional historical snapshots. */
export const dashboardService = {
  /** Live summary metrics computed from the imported workbook data. */
  async summary(user?: AuthUser) {
    // Pipeline figures are shared, but the approvals tile has to agree with the
    // Approvals tab — counting everyone's pending requests here would show you a
    // number you can't act on and hint at other people's agent activity.
    const approvalScope = currentScopeWhere(user);
    const pendingWhere = { approvalStatus: 'Pending' };
    const [activeOpportunities, totalMilestones, milestonesAtRisk, blockedMilestones, pendingApprovals, revenue] =
      await Promise.all([
        prisma.opportunity.count({ where: { status: 'Active' } }),
        prisma.opportunityMilestone.count(),
        prisma.opportunityMilestone.count({ where: { milestoneStatus: 'At Risk' } }),
        prisma.opportunityMilestone.count({ where: { milestoneStatus: 'Blocked' } }),
        prisma.approvalRequest.count({
          where: approvalScope ? { AND: [pendingWhere, approvalScope] } : pendingWhere,
        }),
        prisma.opportunity.aggregate({ _sum: { estimatedRevenue: true } }),
      ]);
    return {
      activeOpportunities,
      totalMilestones,
      milestonesAtRisk,
      blockedMilestones,
      pendingApprovals,
      pipelineValue: revenue._sum.estimatedRevenue ?? 0,
    };
  },

  listSnapshots() {
    return prisma.dashboardMetricSnapshot.findMany({ orderBy: { snapshotName: 'asc' }, take: 200 });
  },

  /** Persist caller-supplied metrics as a point-in-time snapshot stamped by the server. */
  createSnapshot(input: CreateInput) {
    const { snapshotName, ...rest } = input;
    return prisma.dashboardMetricSnapshot.create({
      data: { ...rest, snapshotName: snapshotName || genId('SNAP'), snapshotDate: new Date() },
    });
  },
};
