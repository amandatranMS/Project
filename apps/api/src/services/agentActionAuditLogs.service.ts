import { prisma } from '../lib/prisma.js';
import { genId } from '../lib/ids.js';
import { connectOpportunity, connectMilestone, connectRecommendation } from '../lib/connect.js';
import type { AuthUser } from '../lib/entraAuth.js';
import { currentOwnerId, currentScopeWhere } from '../lib/requestContext.js';
import type { z } from 'zod';
import type { createAuditLogSchema } from '../validators/schemas.js';

type CreateInput = z.infer<typeof createAuditLogSchema>;

/**
 * Persists and retrieves the governance trail for agent and system actions.
 * Audit rows are private to their owning Entra user unless ownerId is null,
 * which marks seeded or system activity that may be shared.
 */
export const agentActionAuditLogsService = {
  /** Return the caller's audit rows plus shared rows, with optional API filters. */
  list(where: { agentName?: string; actionType?: string }, user?: AuthUser) {
    const scope = currentScopeWhere(user);
    return prisma.agentActionAuditLog.findMany({
      where: scope ? { AND: [where, scope] } : where,
      orderBy: { createdAt: 'desc' },
      take: 300,
      omit: { ownerId: true },
    });
  },

  /**
   * Create a timestamped audit row and resolve friendly business identifiers
   * into Prisma relations. The request context supplies the owning Entra oid.
   */
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
