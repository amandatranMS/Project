import { asyncHandler, sendOk } from '../lib/responses.js';
import { HttpError } from '../lib/httpError.js';
import { dealTeamMembersService } from '../services/dealTeamMembers.service.js';
import { createDealTeamMemberSchema } from '../validators/schemas.js';

const q = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

export const dealTeamMembersController = {
  list: asyncHandler(async (req, res) => {
    const opportunityId = q(req.query.opportunityId);
    if (!opportunityId) throw new HttpError(400, 'opportunityId query parameter is required.');
    const data = await dealTeamMembersService.list({ opportunityId });
    sendOk(res, data);
  }),

  create: asyncHandler(async (req, res) => {
    const input = createDealTeamMemberSchema.parse(req.body);
    const data = await dealTeamMembersService.create(input);
    sendOk(res, data, 201);
  }),
};
