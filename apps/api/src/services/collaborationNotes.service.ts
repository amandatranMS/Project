import { prisma } from '../lib/prisma.js';
import { genId } from '../lib/ids.js';
import { connectOpportunity, connectMilestone } from '../lib/connect.js';
import type { z } from 'zod';
import type { createNoteSchema } from '../validators/schemas.js';

type CreateInput = z.infer<typeof createNoteSchema>;

/** Provides the opportunity/milestone collaboration-note read and create operations. */
export const collaborationNotesService = {
  /** Return newest notes, optionally scoped to an opportunity or milestone. */
  list(where: { opportunityId?: string; relatedMilestoneId?: string }) {
    return prisma.collaborationNote.findMany({ where, orderBy: { createdOn: 'desc' }, take: 300 });
  },

  /** Create a timestamped note and connect it through user-facing business identifiers. */
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
