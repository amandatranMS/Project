import { asyncHandler, sendOk } from '../lib/responses.js';
import { collaborationNotesService } from '../services/collaborationNotes.service.js';
import { createNoteSchema } from '../validators/schemas.js';

const q = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

export const collaborationNotesController = {
  list: asyncHandler(async (req, res) => {
    const data = await collaborationNotesService.list({
      opportunityId: q(req.query.opportunityId),
      relatedMilestoneId: q(req.query.relatedMilestoneId),
    });
    sendOk(res, data);
  }),

  create: asyncHandler(async (req, res) => {
    const input = createNoteSchema.parse(req.body);
    const data = await collaborationNotesService.create(input);
    sendOk(res, data, 201);
  }),
};
