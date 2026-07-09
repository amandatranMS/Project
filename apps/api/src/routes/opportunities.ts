import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler, HttpError } from '../middleware/errorHandler.js';
import { createOpportunitySchema, updateOpportunitySchema } from '../schemas.js';

export const opportunitiesRouter = Router();

opportunitiesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { status, salesStage, solutionArea } = req.query;
    const opportunities = await prisma.opportunity.findMany({
      where: {
        status: typeof status === 'string' ? status : undefined,
        salesStage: typeof salesStage === 'string' ? salesStage : undefined,
        solutionArea: typeof solutionArea === 'string' ? solutionArea : undefined,
      },
      orderBy: { opportunityBusinessId: 'asc' },
      include: { _count: { select: { milestones: true } } },
    });
    res.json(opportunities);
  }),
);

opportunitiesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const opportunity = await prisma.opportunity.findUnique({
      where: { id: req.params.id },
      include: {
        milestones: { orderBy: { milestoneBusinessId: 'asc' } },
        dealTeamMembers: true,
        collaborationNotes: { orderBy: { createdOn: 'desc' } },
        recommendations: { orderBy: { recommendationBusinessId: 'asc' } },
      },
    });
    if (!opportunity) throw new HttpError(404, 'Opportunity not found');
    res.json(opportunity);
  }),
);

opportunitiesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = createOpportunitySchema.parse(req.body);
    const opportunity = await prisma.opportunity.create({
      data: { ...data, closeDate: data.closeDate ? new Date(data.closeDate) : null },
    });
    res.status(201).json(opportunity);
  }),
);

opportunitiesRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = updateOpportunitySchema.parse(req.body);
    const existing = await prisma.opportunity.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new HttpError(404, 'Opportunity not found');
    const opportunity = await prisma.opportunity.update({
      where: { id: req.params.id },
      data: { ...data, closeDate: data.closeDate ? new Date(data.closeDate) : undefined },
    });
    res.json(opportunity);
  }),
);

opportunitiesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.opportunity.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new HttpError(404, 'Opportunity not found');
    await prisma.opportunity.delete({ where: { id: req.params.id } });
    res.status(204).send();
  }),
);
