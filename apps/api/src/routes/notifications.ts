import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler, HttpError } from '../middleware/errorHandler.js';

export const notificationsRouter = Router();

notificationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { notifyRole, status } = req.query;
    const notifications = await prisma.agentNotification.findMany({
      where: {
        notifyRole: typeof notifyRole === 'string' ? notifyRole : undefined,
        status: typeof status === 'string' ? status : undefined,
      },
      orderBy: { createdDate: 'desc' },
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
      data: { status: 'Read' },
    });
    res.json(notification);
  }),
);
