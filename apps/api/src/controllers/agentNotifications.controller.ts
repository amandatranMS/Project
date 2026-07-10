import { asyncHandler, sendOk } from '../lib/responses.js';
import { agentNotificationsService } from '../services/agentNotifications.service.js';
import { createNotificationSchema, updateNotificationSchema } from '../validators/schemas.js';

const q = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

export const agentNotificationsController = {
  list: asyncHandler(async (req, res) => {
    const data = await agentNotificationsService.list({
      notifyRole: q(req.query.notifyRole),
      status: q(req.query.status),
    });
    sendOk(res, data);
  }),

  create: asyncHandler(async (req, res) => {
    const input = createNotificationSchema.parse(req.body);
    const data = await agentNotificationsService.create(input);
    sendOk(res, data, 201);
  }),

  update: asyncHandler(async (req, res) => {
    const input = updateNotificationSchema.parse(req.body);
    const data = await agentNotificationsService.update(req.params.id, input);
    sendOk(res, data);
  }),
};
