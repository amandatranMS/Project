import { asyncHandler, sendOk } from '../lib/responses.js';
import { agentRunLogsService } from '../services/agentRunLogs.service.js';
import { createRunLogSchema } from '../validators/schemas.js';

export const agentRunLogsController = {
  list: asyncHandler(async (_req, res) => {
    const data = await agentRunLogsService.list();
    sendOk(res, data);
  }),

  create: asyncHandler(async (req, res) => {
    const input = createRunLogSchema.parse(req.body);
    const data = await agentRunLogsService.create(input);
    sendOk(res, data, 201);
  }),
};
