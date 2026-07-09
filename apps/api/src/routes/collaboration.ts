import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler, HttpError } from '../middleware/errorHandler.js';
import { createNoteSchema, createDealTeamMemberSchema } from '../schemas.js';

// Collaboration notes + deal team members grouped as "collaboration".
export const collaborationRouter = Router();

// ---- Collaboration notes ----
collaborationRouter.get(
  '/notes',
  asyncHandler(async (req, res) => {
    const { opportunityId, relatedMilestoneId } = req.query;
    const notes = await prisma.collaborationNote.findMany({
      where: {
        opportunityId: typeof opportunityId === 'string' ? opportunityId : undefined,
        relatedMilestoneId: typeof relatedMilestoneId === 'string' ? relatedMilestoneId : undefined,
      },
      orderBy: { createdOn: 'desc' },
    });
    res.json(notes);
  }),
);

collaborationRouter.post(
  '/notes',
  asyncHandler(async (req, res) => {
    const data = createNoteSchema.parse(req.body);
    const { opportunityName, relatedMilestoneBusinessId, ...rest } = data;
    const note = await prisma.collaborationNote.create({
      data: {
        ...rest,
        createdOn: new Date(),
        opportunity: opportunityName ? { connect: { opportunityName } } : undefined,
        relatedMilestone: relatedMilestoneBusinessId
          ? { connect: { milestoneBusinessId: relatedMilestoneBusinessId } }
          : undefined,
      },
    });
    res.status(201).json(note);
  }),
);

// ---- Deal team members ----
collaborationRouter.get(
  '/deal-team',
  asyncHandler(async (req, res) => {
    const { opportunityId } = req.query;
    if (typeof opportunityId !== 'string') throw new HttpError(400, 'opportunityId query param is required');
    const members = await prisma.dealTeamMember.findMany({
      where: { opportunityId },
      orderBy: { dealTeamMemberBusinessId: 'asc' },
    });
    res.json(members);
  }),
);

collaborationRouter.post(
  '/deal-team',
  asyncHandler(async (req, res) => {
    const data = createDealTeamMemberSchema.parse(req.body);
    const { opportunityName, ...rest } = data;
    const member = await prisma.dealTeamMember.create({
      data: { ...rest, opportunity: { connect: { opportunityName } } },
    });
    res.status(201).json(member);
  }),
);
