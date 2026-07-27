import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/httpError.js';
import { genId } from '../lib/ids.js';
import { connectOpportunity, connectMilestone } from '../lib/connect.js';
import type { z } from 'zod';
import type { createRecommendationSchema, updateRecommendationSchema } from '../validators/schemas.js';

type CreateInput = z.infer<typeof createRecommendationSchema>;
type UpdateInput = z.infer<typeof updateRecommendationSchema>;

/** Persists AI milestone proposals; recommendations do not perform milestone writeback themselves. */
export const recommendationsService = {
  /** List proposals with enough opportunity context for review screens. */
  list(where: { reviewStatus?: string; opportunityId?: string }) {
    return prisma.aiMilestoneRecommendation.findMany({
      where,
      orderBy: { recommendationBusinessId: 'asc' },
      include: { opportunity: { select: { opportunityName: true } } },
    });
  },

  /** Load one proposal together with the records needed for approval review. */
  get(id: string) {
    return prisma.aiMilestoneRecommendation.findUnique({
      where: { id },
      include: { opportunity: true, relatedMilestone: true, approvalRequests: true },
    });
  },

  /** Create a proposal and resolve its optional opportunity and milestone links. */
  async create(input: CreateInput) {
    const { recommendationBusinessId, opportunityName, relatedMilestoneBusinessId, suggestedDueDate, ...rest } = input;
    return prisma.aiMilestoneRecommendation.create({
      data: {
        ...rest,
        recommendationBusinessId: recommendationBusinessId || genId('REC'),
        suggestedDueDate: suggestedDueDate ? new Date(suggestedDueDate) : null,
        opportunity: connectOpportunity(opportunityName),
        relatedMilestone: connectMilestone(relatedMilestoneBusinessId),
      },
    });
  },

  /** Update reviewable fields without executing the proposed change. */
  async update(id: string, input: UpdateInput) {
    const existing = await prisma.aiMilestoneRecommendation.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Recommendation not found.');
    return prisma.aiMilestoneRecommendation.update({ where: { id }, data: input });
  },
};
