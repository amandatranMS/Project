import { asyncHandler, sendOk } from '../lib/responses.js';
import { searchService } from '../services/search.service.js';
import { searchSchema } from '../validators/schemas.js';

/** Universal "look up ANY field" search across the global business records. */
export const searchController = {
  search: asyncHandler(async (req, res) => {
    const { q, entity, field, limit } = searchSchema.parse(req.query);
    const data = await searchService.search(q, { entity, field, limit });
    sendOk(res, data);
  }),
};
