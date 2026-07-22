import { asyncHandler, sendOk } from '../lib/responses.js';
import { statusHistoryService } from '../services/statusHistory.service.js';
import { createStatusHistorySchema } from '../validators/schemas.js';

const q = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

export const statusHistoryController = {
  list: asyncHandler(async (req, res) => {
    const data = await statusHistoryService.list({ milestoneId: q(req.query.milestoneId) });
    sendOk(res, data);
  }),

  create: asyncHandler(async (req, res) => {
    const input = createStatusHistorySchema.parse(req.body);
    const data = await statusHistoryService.create(input, {
      user: req.user,
      changedBy: req.user?.name ?? input.changedBy ?? undefined,
      acknowledgeManagerEmail: req.body?.acknowledgeManagerEmail === true,
    });
    sendOk(res, data, 201);
  }),
};
