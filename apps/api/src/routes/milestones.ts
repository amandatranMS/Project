import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler, HttpError } from '../middleware/errorHandler.js';
import { createMilestoneSchema, updateMilestoneSchema, changeStatusSchema } from '../schemas.js';

export const milestonesRouter = Router();

milestonesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { opportunityId, milestoneStatus } = req.query;
    const milestones = await prisma.opportunityMilestone.findMany({
      where: {
        opportunityId: typeof opportunityId === 'string' ? opportunityId : undefined,
        milestoneStatus: typeof milestoneStatus === 'string' ? milestoneStatus : undefined,
      },
      orderBy: { milestoneBusinessId: 'asc' },
      include: { opportunity: { select: { id: true, opportunityName: true, customerName: true } } },
    });
    res.json(milestones);
  }),
);

milestonesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const milestone = await prisma.opportunityMilestone.findUnique({
      where: { id: req.params.id },
      include: {
        opportunity: true,
        statusHistories: { orderBy: { statusDate: 'desc' } },
        recommendations: true,
        approvalRequests: true,
        collaborationNotes: true,
      },
    });
    if (!milestone) throw new HttpError(404, 'Milestone not found');
    res.json(milestone);
  }),
);

milestonesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = createMilestoneSchema.parse(req.body);
    const { opportunityName, estDate, ...rest } = data;
    const opportunity = await prisma.opportunity.findUnique({ where: { opportunityName } });
    if (!opportunity) throw new HttpError(400, 'opportunityName does not reference an existing opportunity');
    const milestone = await prisma.opportunityMilestone.create({
      data: {
        ...rest,
        estDate: estDate ? new Date(estDate) : null,
        opportunity: { connect: { opportunityName } },
      },
    });
    res.status(201).json(milestone);
  }),
);

milestonesRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = updateMilestoneSchema.parse(req.body);
    const existing = await prisma.opportunityMilestone.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new HttpError(404, 'Milestone not found');
    const milestone = await prisma.opportunityMilestone.update({
      where: { id: req.params.id },
      data: { ...data, estDate: data.estDate ? new Date(data.estDate) : undefined },
    });
    res.json(milestone);
  }),
);

// Status change also writes a Milestone Status History row.
milestonesRouter.post(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const { newStatus, changedBy, reason } = changeStatusSchema.parse(req.body);
    const existing = await prisma.opportunityMilestone.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new HttpError(404, 'Milestone not found');

    const [milestone] = await prisma.$transaction([
      prisma.opportunityMilestone.update({
        where: { id: req.params.id },
        data: { milestoneStatus: newStatus },
      }),
      prisma.milestoneStatusHistory.create({
        data: {
          statusHistoryBusinessId: `SH-RUNTIME-${Date.now()}`,
          milestone: { connect: { id: req.params.id } },
          opportunity: { connect: { id: existing.opportunityId } },
          oldStatus: existing.milestoneStatus,
          newStatus,
          statusDate: new Date(),
          reason,
          changedBy,
        },
      }),
    ]);
    res.json(milestone);
  }),
);

milestonesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.opportunityMilestone.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new HttpError(404, 'Milestone not found');
    await prisma.opportunityMilestone.delete({ where: { id: req.params.id } });
    res.status(204).send();
  }),
);
