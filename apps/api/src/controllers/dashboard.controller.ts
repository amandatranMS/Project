import { asyncHandler, sendOk } from '../lib/responses.js';
import { dashboardService } from '../services/dashboard.service.js';
import { createSnapshotSchema } from '../validators/schemas.js';

export const dashboardController = {
  summary: asyncHandler(async (req, res) => {
    const data = await dashboardService.summary(req.user);
    sendOk(res, data);
  }),

  listSnapshots: asyncHandler(async (_req, res) => {
    const data = await dashboardService.listSnapshots();
    sendOk(res, data);
  }),

  createSnapshot: asyncHandler(async (req, res) => {
    const input = createSnapshotSchema.parse(req.body);
    const data = await dashboardService.createSnapshot(input);
    sendOk(res, data, 201);
  }),
};
