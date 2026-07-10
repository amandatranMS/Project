import { asyncHandler, sendOk } from '../lib/responses.js';
import { agentActionAuditLogsService } from '../services/agentActionAuditLogs.service.js';
import { createAuditLogSchema } from '../validators/schemas.js';

const q = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

export const agentActionAuditLogsController = {
  list: asyncHandler(async (req, res) => {
    const data = await agentActionAuditLogsService.list({
      agentName: q(req.query.agentName),
      actionType: q(req.query.actionType),
    });
    sendOk(res, data);
  }),

  create: asyncHandler(async (req, res) => {
    const input = createAuditLogSchema.parse(req.body);
    const data = await agentActionAuditLogsService.create(input);
    sendOk(res, data, 201);
  }),
};
