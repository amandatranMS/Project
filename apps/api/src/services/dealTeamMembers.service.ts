import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/httpError.js';
import { genId } from '../lib/ids.js';
import { recordAgentAction } from '../lib/audit.js';
import type { z } from 'zod';
import type { createDealTeamMemberSchema, updateDealTeamMemberSchema } from '../validators/schemas.js';

type CreateInput = z.infer<typeof createDealTeamMemberSchema>;
type UpdateInput = z.infer<typeof updateDealTeamMemberSchema>;

export const dealTeamMembersService = {
  list(where: { opportunityId?: string }) {
    return prisma.dealTeamMember.findMany({ where, orderBy: { dealTeamMemberBusinessId: 'asc' } });
  },

  async create(input: CreateInput) {
    const { dealTeamMemberBusinessId, opportunityName, addedDate, ...rest } = input;
    const opportunity = await prisma.opportunity.findUnique({ where: { opportunityName } });
    if (!opportunity) throw new HttpError(400, `Opportunity "${opportunityName}" was not found.`);
    return prisma.dealTeamMember.create({
      data: {
        ...rest,
        addedDate: addedDate ? new Date(addedDate) : null,
        dealTeamMemberBusinessId: dealTeamMemberBusinessId || genId('DT'),
        opportunity: { connect: { opportunityName } },
      },
    });
  },

  async update(id: string, input: UpdateInput, actor?: string) {
    const existing = await prisma.dealTeamMember.findFirst({
      where: { OR: [{ id }, { dealTeamMemberBusinessId: id }] },
    });
    if (!existing) throw new HttpError(404, 'Deal team member not found.');
    const { addedDate, ...rest } = input;
    const member = await prisma.dealTeamMember.update({
      where: { id: existing.id },
      data: { ...rest, addedDate: addedDate ? new Date(addedDate) : undefined },
    });

    const changedFields = Object.keys(input).filter(
      (k) => (input as Record<string, unknown>)[k] !== undefined,
    );
    await recordAgentAction({
      agentName: actor ?? 'system',
      actionType: 'Update',
      actionName: 'Deal team member updated',
      opportunityId: existing.opportunityId,
      inputSummary: `Updated ${existing.dealTeamMemberBusinessId}${
        changedFields.length ? ` (fields: ${changedFields.join(', ')})` : ''
      }`,
    });

    return member;
  },
};
