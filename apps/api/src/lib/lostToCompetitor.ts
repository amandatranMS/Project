import { LOST_TO_COMPETITOR } from '@msx/shared';
import { HttpError } from './httpError.js';

/**
 * Plain-language message surfaced (as a 422) when someone tries to mark a
 * milestone "Lost To Competitor" without recording which competitor it was lost
 * to. The web client shows this as the "fill in the competitor" pop-up.
 */
export const COMPETITOR_REQUIRED_MESSAGE =
  'A competitor is required before a milestone can be marked "Lost To Competitor". Please add the competitor name and try again.';

/**
 * Domain rule shared by every write path that can set a milestone's status: a
 * milestone can only be "Lost To Competitor" when a (milestone-level) competitor
 * name is present. Throws HttpError(422) otherwise; a no-op for any other status.
 */
export function assertCompetitorForLostStatus(
  status: string | null | undefined,
  competitorName: string | null | undefined,
): void {
  if (status === LOST_TO_COMPETITOR && !competitorName?.trim()) {
    throw new HttpError(422, COMPETITOR_REQUIRED_MESSAGE);
  }
}
