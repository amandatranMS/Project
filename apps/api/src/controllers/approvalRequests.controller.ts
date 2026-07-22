import { asyncHandler, sendOk } from '../lib/responses.js';
import { HttpError } from '../lib/httpError.js';
import { approvalRequestsService } from '../services/approvalRequests.service.js';
import { createApprovalSchema, updateApprovalSchema, approvalDecisionSchema } from '../validators/schemas.js';

const q = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

export const approvalRequestsController = {
  list: asyncHandler(async (req, res) => {
    const data = await approvalRequestsService.list({ approvalStatus: q(req.query.approvalStatus) }, req.user);
    sendOk(res, data);
  }),

  get: asyncHandler(async (req, res) => {
    const data = await approvalRequestsService.get(req.params.id);
    if (!data) throw new HttpError(404, 'Approval request not found.');
    sendOk(res, data);
  }),

  create: asyncHandler(async (req, res) => {
    const input = createApprovalSchema.parse(req.body);
    const data = await approvalRequestsService.create(input);
    sendOk(res, data, 201);
  }),

  update: asyncHandler(async (req, res) => {
    const input = updateApprovalSchema.parse(req.body);
    const data = await approvalRequestsService.update(req.params.id, input);
    sendOk(res, data);
  }),

  approve: asyncHandler(async (req, res) => {
    const input = approvalDecisionSchema.parse(req.body);
    const data = await approvalRequestsService.decide(req.params.id, 'Approved', input, req.user);
    sendOk(res, data);
  }),

  reject: asyncHandler(async (req, res) => {
    const input = approvalDecisionSchema.parse(req.body);
    const data = await approvalRequestsService.decide(req.params.id, 'Rejected', input, req.user);
    sendOk(res, data);
  }),

  needsChanges: asyncHandler(async (req, res) => {
    const input = approvalDecisionSchema.parse(req.body);
    const data = await approvalRequestsService.decide(req.params.id, 'Needs Changes', input, req.user);
    sendOk(res, data);
  }),
};
