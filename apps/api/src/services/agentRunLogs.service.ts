import { prisma } from '../lib/prisma.js';
import { genId } from '../lib/ids.js';
import { connectOpportunity, connectMilestone } from '../lib/connect.js';
import type { z } from 'zod';
import type { createRunLogSchema } from '../validators/schemas.js';

type CreateInput = z.infer<typeof createRunLogSchema>;

export const agentRunLogsService = {
  list() {
    return prisma.agentRunLog.findMany({ orderBy: { runName: 'asc' }, take: 200 });
  },

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
