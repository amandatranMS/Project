import { asyncHandler, sendOk } from '../lib/responses.js';
import { HttpError } from '../lib/httpError.js';
import { opportunitiesService } from '../services/opportunities.service.js';

const q = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

export const opportunitiesController = {
  list: asyncHandler(async (req, res) => {
    const data = await opportunitiesService.list({
      status: q(req.query.status),
      salesStage: q(req.query.salesStage),
      solutionArea: q(req.query.solutionArea),
    });
    sendOk(res, data);
  }),

  get: asyncHandler(async (req, res) => {
    const data = await opportunitiesService.get(req.params.id);
    if (!data) throw new HttpError(404, 'Opportunity not found.');
    sendOk(res, data);
  }),

  context: asyncHandler(async (req, res) => {
    const data = await opportunitiesService.context(req.params.id);
    if (!data) throw new HttpError(404, 'Opportunity not found.');
    sendOk(res, data);
  }),
};
