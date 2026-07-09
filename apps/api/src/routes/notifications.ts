import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler, HttpError } from '../middleware/errorHandler.js';

export const notificationsRouter = Router();

notificationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { recipient, isRead } = req.query;
    const notifications = await prisma.agentNotification.findMany({
      where: {
        recipient: typeof recipient === 'string' ? recipient : undefined,
        isRead: typeof isRead === 'string' ? isRead === 'true' : undefined,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json(notifications);
  }),
);

notificationsRouter.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const existing = await prisma.agentNotification.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new HttpError(404, 'Notification not found');
    const notification = await prisma.agentNotification.update({
      where: { id: req.params.id },
      data: { isRead: true },
    });
    res.json(notification);
  }),
);
