import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler, HttpError } from '../middleware/errorHandler.js';
import { createMilestoneSchema, updateMilestoneSchema, changeStatusSchema } from '../schemas.js';

export const milestonesRouter = Router();

milestonesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { opportunityId, status } = req.query;
    const milestones = await prisma.opportunityMilestone.findMany({
      where: {
        opportunityId: typeof opportunityId === 'string' ? opportunityId : undefined,
        status: typeof status === 'string' ? status : undefined,
      },
      orderBy: { updatedAt: 'desc' },
      include: { opportunity: { select: { id: true, name: true, accountName: true } } },
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
        statusHistory: { orderBy: { changedAt: 'desc' } },
        recommendations: { orderBy: { createdAt: 'desc' } },
        approvalRequests: { orderBy: { createdAt: 'desc' } },
        collaborationNotes: { orderBy: { createdAt: 'desc' } },
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
    const opportunity = await prisma.opportunity.findUnique({ where: { id: data.opportunityId } });
    if (!opportunity) throw new HttpError(400, 'opportunityId does not reference an existing opportunity');
    const milestone = await prisma.opportunityMilestone.create({
      data: {
        ...data,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        completedDate: data.completedDate ? new Date(data.completedDate) : null,
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
      data: {
        ...data,
        dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
        completedDate: data.completedDate ? new Date(data.completedDate) : undefined,
      },
    });
    res.json(milestone);
  }),
);

// Status change also writes a Milestone Status History row.
milestonesRouter.post(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const { newStatus, changedBy, changeReason } = changeStatusSchema.parse(req.body);
    const existing = await prisma.opportunityMilestone.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new HttpError(404, 'Milestone not found');

    const [milestone] = await prisma.$transaction([
      prisma.opportunityMilestone.update({
        where: { id: req.params.id },
        data: {
          status: newStatus,
          completedDate: newStatus === 'Completed' ? new Date() : existing.completedDate,
        },
      }),
      prisma.milestoneStatusHistory.create({
        data: {
          milestoneId: req.params.id,
          previousStatus: existing.status,
          newStatus,
          changedBy,
          changeReason,
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
