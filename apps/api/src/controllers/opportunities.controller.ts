import { asyncHandler, sendOk } from '../lib/responses.js';
import { HttpError } from '../lib/httpError.js';
import { opportunitiesService } from '../services/opportunities.service.js';
import { opportunityBroadcastService } from '../services/opportunityBroadcast.service.js';
import {
  createOpportunitySchema,
  updateOpportunitySchema,
  announceOpportunitySchema,
} from '../validators/schemas.js';

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

  /** Preview the next auto-assigned sequential TPID for a new opportunity. */
  nextTpid: asyncHandler(async (_req, res) => {
    const tpid = await opportunitiesService.nextTpid();
    sendOk(res, { tpid });
  }),

  context: asyncHandler(async (req, res) => {
    const data = await opportunitiesService.context(req.params.id);
    if (!data) throw new HttpError(404, 'Opportunity not found.');
    sendOk(res, data);
  }),

  create: asyncHandler(async (req, res) => {
    const input = createOpportunitySchema.parse(req.body);
    // An agent-initiated direct create must queue the approval-gated Teams broadcast
    // ('queue'). The Foundry hosted agent calls back over the dev tunnel acting on
    // behalf of the user and echoes the x-msx-session handle (the web UI never
    // sends it); a key-based agent authenticates as a service principal. Either
    // signal marks this as an agent create. A human using the form has neither, so
    // it stays 'none' (the inline consent modal drives the send).
    const viaAgent = req.user?.kind === 'service' || Boolean(req.header('x-msx-session'));
    const data = await opportunitiesService.create(input, req.user, viaAgent ? 'queue' : 'none');
    sendOk(res, data, 201);
  }),

  /**
   * Human-consented "notify the team of this new opportunity" Teams broadcast.
   * Called from the inline consent modal after a manual create. `confirm: true`
   * (from the modal) authorises the live send; the service posts a 1:1 Teams DM
   * to the configured recipient and audits it.
   */
  announce: asyncHandler(async (req, res) => {
    const { confirm } = announceOpportunitySchema.parse(req.body ?? {});
    const data = await opportunityBroadcastService.announce(req.params.id, req.user, confirm ?? false);
    sendOk(res, data);
  }),

  update: asyncHandler(async (req, res) => {
    const input = updateOpportunitySchema.parse(req.body);
    const data = await opportunitiesService.update(req.params.id, input);
    sendOk(res, data);
  }),

  remove: asyncHandler(async (req, res) => {
    const cascade = q(req.query.cascade) === 'true';
    const data = await opportunitiesService.remove(req.params.id, cascade);
    sendOk(res, data);
  }),
};
