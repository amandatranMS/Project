import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/httpError.js';
import { genId } from '../lib/ids.js';
import { recordAgentAction } from '../lib/audit.js';
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
    const recommendation = await prisma.aiMilestoneRecommendation.create({
      data: {
        ...rest,
        recommendationBusinessId: recommendationBusinessId || genId('REC'),
        suggestedDueDate: suggestedDueDate ? new Date(suggestedDueDate) : null,
        opportunity: connectOpportunity(opportunityName),
        relatedMilestone: connectMilestone(relatedMilestoneBusinessId),
      },
    });

    await recordAgentAction({
      agentName: recommendation.createdByAgent ? 'agent' : 'system',
      actionType: 'Create',
      actionName: 'Recommendation created',
      opportunityId: recommendation.opportunityId,
      relatedMilestoneId: recommendation.relatedMilestoneId,
      relatedRecommendationId: recommendation.id,
      inputSummary: `Proposed "${recommendation.recommendedMilestoneTitle ?? 'milestone'}" (${recommendation.recommendationBusinessId})`,
    });

    return recommendation;
  },

  /** Update reviewable fields without executing the proposed change. */
  async update(id: string, input: UpdateInput) {
    const existing = await prisma.aiMilestoneRecommendation.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Recommendation not found.');
    const recommendation = await prisma.aiMilestoneRecommendation.update({ where: { id }, data: input });

    const changedFields = Object.keys(input).filter(
      (k) => (input as Record<string, unknown>)[k] !== undefined,
    );
    await recordAgentAction({
      agentName: 'system',
      actionType: 'Update',
      actionName: 'Recommendation updated',
      opportunityId: recommendation.opportunityId,
      relatedMilestoneId: recommendation.relatedMilestoneId,
      relatedRecommendationId: recommendation.id,
      inputSummary: `Updated ${recommendation.recommendationBusinessId}${
        changedFields.length ? ` (fields: ${changedFields.join(', ')})` : ''
      }`,
    });

    return recommendation;
  },
};
