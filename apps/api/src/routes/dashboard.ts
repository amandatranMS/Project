import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errorHandler.js';

export const dashboardRouter = Router();

// Live metrics computed on demand from the imported workbook data.
dashboardRouter.get(
  '/metrics',
  asyncHandler(async (_req, res) => {
    const [
      activeOpportunities,
      totalMilestones,
      milestonesAtRisk,
      blockedMilestones,
      pendingApprovals,
      totalPipeline,
    ] = await Promise.all([
      prisma.opportunity.count({ where: { status: 'Active' } }),
      prisma.opportunityMilestone.count(),
      prisma.opportunityMilestone.count({ where: { milestoneStatus: 'At Risk' } }),
      prisma.opportunityMilestone.count({ where: { milestoneStatus: 'Blocked' } }),
      prisma.approvalRequest.count({ where: { approvalStatus: 'Pending' } }),
      prisma.opportunity.aggregate({ _sum: { estimatedRevenue: true } }),
    ]);

    res.json({
      activeOpportunities,
      totalMilestones,
      milestonesAtRisk,
      blockedMilestones,
      pendingApprovals,
      pipelineValue: totalPipeline._sum.estimatedRevenue ?? 0,
    });
  }),
);

// The workbook's own Dashboard Metric Snapshot rows.
dashboardRouter.get(
  '/snapshots',
  asyncHandler(async (_req, res) => {
    const snapshots = await prisma.dashboardMetricSnapshot.findMany({
      orderBy: { snapshotName: 'asc' },
      take: 100,
    });
    res.json(snapshots);
  }),
);
