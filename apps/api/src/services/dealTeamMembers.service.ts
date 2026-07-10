import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/httpError.js';
import { genId } from '../lib/ids.js';
import type { z } from 'zod';
import type { createDealTeamMemberSchema } from '../validators/schemas.js';

type CreateInput = z.infer<typeof createDealTeamMemberSchema>;

export const dealTeamMembersService = {
  list(where: { opportunityId?: string }) {
    return prisma.dealTeamMember.findMany({ where, orderBy: { dealTeamMemberBusinessId: 'asc' } });
  },

  async create(input: CreateInput) {
    const { dealTeamMemberBusinessId, opportunityName, ...rest } = input;
    const opportunity = await prisma.opportunity.findUnique({ where: { opportunityName } });
    if (!opportunity) throw new HttpError(400, `Opportunity "${opportunityName}" was not found.`);
    return prisma.dealTeamMember.create({
      data: {
        ...rest,
        dealTeamMemberBusinessId: dealTeamMemberBusinessId || genId('DT'),
        opportunity: { connect: { opportunityName } },
      },
    });
  },
};
