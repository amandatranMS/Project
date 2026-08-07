import { asyncHandler, sendOk } from '../lib/responses.js';
import { HttpError } from '../lib/httpError.js';
import { milestonesService } from '../services/milestones.service.js';
import { handoffService } from '../services/handoff.service.js';
import { createMilestoneSchema, updateMilestoneSchema } from '../validators/schemas.js';

const q = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

export const milestonesController = {
  list: asyncHandler(async (req, res) => {
    const data = await milestonesService.list({
      opportunityId: q(req.query.opportunityId),
      milestoneStatus: q(req.query.milestoneStatus),
    });
    sendOk(res, data);
  }),

  get: asyncHandler(async (req, res) => {
    const data = await milestonesService.get(req.params.id);
    if (!data) throw new HttpError(404, 'Milestone not found.');
    sendOk(res, data);
  }),

  /** Capability #2: which CSA-critical handoff items this milestone captures, plus a description scaffold. */
  handoffReadiness: asyncHandler(async (req, res) => {
    const data = await handoffService.milestoneReadiness(req.params.id);
    sendOk(res, data);
  }),

  create: asyncHandler(async (req, res) => {
    const input = createMilestoneSchema.parse(req.body);
    const data = await milestonesService.create(input);
    sendOk(res, data, 201);
  }),

  update: asyncHandler(async (req, res) => {
    const input = updateMilestoneSchema.parse(req.body);
    const data = await milestonesService.update(req.params.id, input, {
      user: req.user,
      changedBy: req.user?.name ?? input.createdBy ?? undefined,
      acknowledgeManagerEmail: req.body?.acknowledgeManagerEmail === true,
    });
    sendOk(res, data);
  }),

  remove: asyncHandler(async (req, res) => {
    const data = await milestonesService.remove(req.params.id);
    sendOk(res, data);
  }),
};
