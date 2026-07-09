import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler, HttpError } from '../middleware/errorHandler.js';
import { createNoteSchema, createDealTeamMemberSchema } from '../schemas.js';

// Collaboration notes + deal team members grouped together as "collaboration".
export const collaborationRouter = Router();

// ---- Collaboration notes ----
collaborationRouter.get(
  '/notes',
  asyncHandler(async (req, res) => {
    const { opportunityId, milestoneId } = req.query;
    const notes = await prisma.collaborationNote.findMany({
      where: {
        opportunityId: typeof opportunityId === 'string' ? opportunityId : undefined,
        milestoneId: typeof milestoneId === 'string' ? milestoneId : undefined,
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(notes);
  }),
);

collaborationRouter.post(
  '/notes',
  asyncHandler(async (req, res) => {
    const data = createNoteSchema.parse(req.body);
    const note = await prisma.collaborationNote.create({ data });
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
      orderBy: { createdAt: 'asc' },
    });
    res.json(members);
  }),
);

collaborationRouter.post(
  '/deal-team',
  asyncHandler(async (req, res) => {
    const data = createDealTeamMemberSchema.parse(req.body);
    const member = await prisma.dealTeamMember.create({ data });
    res.status(201).json(member);
  }),
);
