import { prisma } from '../lib/prisma.js';
import { genId } from '../lib/ids.js';
import { connectOpportunity, connectMilestone } from '../lib/connect.js';
import type { z } from 'zod';
import type { createNoteSchema } from '../validators/schemas.js';

type CreateInput = z.infer<typeof createNoteSchema>;

export const collaborationNotesService = {
  list(where: { opportunityId?: string; relatedMilestoneId?: string }) {
    return prisma.collaborationNote.findMany({ where, orderBy: { createdOn: 'desc' }, take: 300 });
  },

  create(input: CreateInput) {
    const { collaborationNoteBusinessId, opportunityName, relatedMilestoneBusinessId, ...rest } = input;
    return prisma.collaborationNote.create({
      data: {
        ...rest,
        collaborationNoteBusinessId: collaborationNoteBusinessId || genId('CN'),
        createdOn: new Date(),
        opportunity: connectOpportunity(opportunityName),
        relatedMilestone: connectMilestone(relatedMilestoneBusinessId),
      },
    });
  },
};
