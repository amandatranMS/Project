import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/httpError.js';
import { genId } from '../lib/ids.js';
import { connectOpportunity, connectMilestone } from '../lib/connect.js';
import type { z } from 'zod';
import type { createNotificationSchema, updateNotificationSchema } from '../validators/schemas.js';

type CreateInput = z.infer<typeof createNotificationSchema>;
type UpdateInput = z.infer<typeof updateNotificationSchema>;

/** Manages the mock in-app notification feed produced by agents and workflows. */
export const agentNotificationsService = {
  /** Return the newest matching notifications, capped for predictable API responses. */
  list(where: { notifyRole?: string; status?: string }) {
    return prisma.agentNotification.findMany({ where, orderBy: { createdDate: 'desc' }, take: 200 });
  },

  /** Create an open notification and connect optional business-record references. */
  create(input: CreateInput) {
    const { notificationBusinessId, opportunityName, relatedMilestoneBusinessId, ...rest } = input;
    return prisma.agentNotification.create({
      data: {
        ...rest,
        notificationBusinessId: notificationBusinessId || genId('NT'),
        status: rest.status ?? 'Open',
        createdDate: new Date(),
        opportunity: connectOpportunity(opportunityName),
        relatedMilestone: connectMilestone(relatedMilestoneBusinessId),
      },
    });
  },

  /** Update mutable notification state after verifying that the row exists. */
  async update(id: string, input: UpdateInput) {
    const existing = await prisma.agentNotification.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Notification not found.');
    return prisma.agentNotification.update({ where: { id }, data: input });
  },
};
