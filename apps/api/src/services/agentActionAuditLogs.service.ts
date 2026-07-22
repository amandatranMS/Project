import { prisma } from '../lib/prisma.js';
import { genId } from '../lib/ids.js';
import { connectOpportunity, connectMilestone, connectRecommendation } from '../lib/connect.js';
import type { AuthUser } from '../lib/entraAuth.js';
import { currentOwnerId, ownerScopeWhere } from '../lib/requestContext.js';
import type { z } from 'zod';
import type { createAuditLogSchema } from '../validators/schemas.js';

type CreateInput = z.infer<typeof createAuditLogSchema>;

export const agentActionAuditLogsService = {
  list(where: { agentName?: string; actionType?: string }, user?: AuthUser) {
    const scope = ownerScopeWhere(user);
    return prisma.agentActionAuditLog.findMany({
      where: scope ? { AND: [where, scope] } : where,
      orderBy: { createdAt: 'desc' },
      take: 300,
      omit: { ownerId: true },
    });
  },

  create(input: CreateInput) {
    const { auditBusinessId, opportunityName, relatedMilestoneBusinessId, relatedRecommendationBusinessId, ...rest } = input;
    return prisma.agentActionAuditLog.create({
      data: {
        ...rest,
        auditBusinessId: auditBusinessId || genId('AU'),
        timestamp: new Date(),
        ownerId: currentOwnerId(),
        opportunity: connectOpportunity(opportunityName),
        relatedMilestone: connectMilestone(relatedMilestoneBusinessId),
        relatedRecommendation: connectRecommendation(relatedRecommendationBusinessId),
      },
    });
  },
};
