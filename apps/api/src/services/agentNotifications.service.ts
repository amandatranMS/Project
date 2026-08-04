import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/httpError.js';
import { genId } from '../lib/ids.js';
import { recordAgentAction } from '../lib/audit.js';
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
  async create(input: CreateInput) {
    const { notificationBusinessId, opportunityName, relatedMilestoneBusinessId, ...rest } = input;
    const notification = await prisma.agentNotification.create({
      data: {
        ...rest,
        notificationBusinessId: notificationBusinessId || genId('NT'),
        status: rest.status ?? 'Open',
        createdDate: new Date(),
        opportunity: connectOpportunity(opportunityName),
        relatedMilestone: connectMilestone(relatedMilestoneBusinessId),
      },
    });

    await recordAgentAction({
      agentName: 'system',
      actionType: 'Notify',
      actionName: 'Notification created',
      opportunityId: notification.opportunityId,
      relatedMilestoneId: notification.relatedMilestoneId,
      inputSummary: `Posted ${notification.notificationBusinessId}${
        notification.notifyRole ? ` to ${notification.notifyRole}` : ''
      }${notification.reasonCode ? ` (${notification.reasonCode})` : ''}`,
    });

    return notification;
  },

  /** Update mutable notification state after verifying that the row exists. */
  async update(id: string, input: UpdateInput) {
    const existing = await prisma.agentNotification.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Notification not found.');
    const notification = await prisma.agentNotification.update({ where: { id }, data: input });

    const changedFields = Object.keys(input).filter(
      (k) => (input as Record<string, unknown>)[k] !== undefined,
    );
    await recordAgentAction({
      agentName: 'system',
      actionType: 'Update',
      actionName: 'Notification updated',
      opportunityId: notification.opportunityId,
      relatedMilestoneId: notification.relatedMilestoneId,
      inputSummary: `Updated ${notification.notificationBusinessId}${
        changedFields.length ? ` (fields: ${changedFields.join(', ')})` : ''
      }`,
    });

    return notification;
  },
};
