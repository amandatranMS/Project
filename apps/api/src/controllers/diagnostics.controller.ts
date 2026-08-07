import { asyncHandler, sendOk } from '../lib/responses.js';
import { metricsSnapshot } from '../lib/graphSessionMetrics.js';

/**
 * Read-only operational diagnostics. Currently exposes the on-behalf-of session
 * handle resolution metrics that power the "can the agent still read Outlook /
 * Teams?" watchdog. The snapshot is PII-free (counts, timestamps, caller kind,
 * and 10-char handle prefixes only) so it is safe behind the standard API auth.
 */
export const diagnosticsController = {
  sessionMetrics: asyncHandler(async (_req, res) => {
    sendOk(res, metricsSnapshot());
  }),
};
