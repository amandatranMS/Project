import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errorHandler.js';

export const dashboardRouter = Router();

// Live metrics computed on demand.
dashboardRouter.get(
  '/metrics',
  asyncHandler(async (_req, res) => {
    const [openOpportunities, totalMilestones, milestonesAtRisk, blockedMilestones, pendingApprovals, totalPipeline] =
      await Promise.all([
        prisma.opportunity.count({ where: { status: 'Open' } }),
        prisma.opportunityMilestone.count(),
        prisma.opportunityMilestone.count({ where: { status: 'At Risk' } }),
        prisma.opportunityMilestone.count({ where: { status: 'Blocked' } }),
        prisma.approvalRequest.count({ where: { status: 'Pending' } }),
        prisma.opportunity.aggregate({ _sum: { estimatedValue: true }, where: { status: 'Open' } }),
      ]);

    res.json({
      openOpportunities,
      totalMilestones,
      milestonesAtRisk,
      blockedMilestones,
      pendingApprovals,
      openPipelineValue: totalPipeline._sum.estimatedValue ?? 0,
    });
  }),
);

// Persist a snapshot of current metrics into Dashboard Metric Snapshot.
dashboardRouter.post(
  '/snapshots',
  asyncHandler(async (_req, res) => {
    const [openOpportunities, milestonesAtRisk, pendingApprovals] = await Promise.all([
      prisma.opportunity.count({ where: { status: 'Open' } }),
      prisma.opportunityMilestone.count({ where: { status: 'At Risk' } }),
      prisma.approvalRequest.count({ where: { status: 'Pending' } }),
    ]);
    const created = await prisma.dashboardMetricSnapshot.createMany({
      data: [
        { metricName: 'OpenOpportunities', metricValue: openOpportunities },
        { metricName: 'MilestonesAtRisk', metricValue: milestonesAtRisk },
        { metricName: 'PendingApprovals', metricValue: pendingApprovals },
      ],
    });
    res.status(201).json({ created: created.count });
  }),
);

dashboardRouter.get(
  '/snapshots',
  asyncHandler(async (_req, res) => {
    const snapshots = await prisma.dashboardMetricSnapshot.findMany({
      orderBy: { snapshotDate: 'desc' },
      take: 100,
    });
    res.json(snapshots);
  }),
);
