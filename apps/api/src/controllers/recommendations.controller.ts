import { asyncHandler, sendOk } from '../lib/responses.js';
import { HttpError } from '../lib/httpError.js';
import { recommendationsService } from '../services/recommendations.service.js';
import { createRecommendationSchema, updateRecommendationSchema } from '../validators/schemas.js';

const q = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

export const recommendationsController = {
  list: asyncHandler(async (req, res) => {
    const data = await recommendationsService.list({
      reviewStatus: q(req.query.reviewStatus),
      opportunityId: q(req.query.opportunityId),
    });
    sendOk(res, data);
  }),

  get: asyncHandler(async (req, res) => {
    const data = await recommendationsService.get(req.params.id);
    if (!data) throw new HttpError(404, 'Recommendation not found.');
    sendOk(res, data);
  }),

  create: asyncHandler(async (req, res) => {
    const input = createRecommendationSchema.parse(req.body);
    const data = await recommendationsService.create(input);
    sendOk(res, data, 201);
  }),

  update: asyncHandler(async (req, res) => {
    const input = updateRecommendationSchema.parse(req.body);
    const data = await recommendationsService.update(req.params.id, input);
    sendOk(res, data);
  }),
};
