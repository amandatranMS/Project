import { prisma } from '../lib/prisma.js';
import { genId } from '../lib/ids.js';
import { connectOpportunity, connectMilestone } from '../lib/connect.js';
import type { z } from 'zod';
import type { createRunLogSchema } from '../validators/schemas.js';

type CreateInput = z.infer<typeof createRunLogSchema>;

/** Stores operational metadata about agent runs; this is separate from action-level auditing. */
export const agentRunLogsService = {
  /** List recent run records in stable business-id order. */
  list() {
    return prisma.agentRunLog.findMany({ orderBy: { runName: 'asc' }, take: 200 });
  },

  /** Start a run record, generating its business id and resolving optional relations. */
  create(input: CreateInput) {
    const { runName, opportunityName, relatedMilestoneBusinessId, ...rest } = input;
    return prisma.agentRunLog.create({
      data: {
        ...rest,
        runName: runName || genId('RUN'),
        startTime: new Date(),
        opportunity: connectOpportunity(opportunityName),
        relatedMilestone: connectMilestone(relatedMilestoneBusinessId),
      },
    });
  },
};
