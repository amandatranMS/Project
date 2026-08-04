import { prisma } from '../lib/prisma.js';
import { genId } from '../lib/ids.js';
import { recordAgentAction } from '../lib/audit.js';
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
  async create(input: CreateInput) {
    const { collaborationNoteBusinessId, opportunityName, relatedMilestoneBusinessId, ...rest } = input;
    const note = await prisma.collaborationNote.create({
      data: {
        ...rest,
        collaborationNoteBusinessId: collaborationNoteBusinessId || genId('CN'),
        createdOn: new Date(),
        opportunity: connectOpportunity(opportunityName),
        relatedMilestone: connectMilestone(relatedMilestoneBusinessId),
      },
    });

    await recordAgentAction({
      agentName: note.createdBy ?? 'system',
      actionType: 'Create',
      actionName: 'Collaboration note added',
      actor: note.createdBy ?? undefined,
      opportunityId: note.opportunityId,
      relatedMilestoneId: note.relatedMilestoneId,
      inputSummary: `Added note ${note.collaborationNoteBusinessId}${note.noteTitle ? ` — "${note.noteTitle}"` : ''}`,
    });

    return note;
  },
};
