import { HttpError } from '../lib/httpError.js';
import { prisma } from '../lib/prisma.js';
import { recordAgentAction } from '../lib/audit.js';
import { scoreHandoff } from '../lib/handoffReadiness.js';
import { scoreMilestoneHandoff } from '../lib/milestoneHandoff.js';
import { assessEcifReadiness } from '../lib/ecifReadiness.js';
import { opportunitiesService } from './opportunities.service.js';

/**
 * Handoff feature service (Capability #1: readiness check).
 *
 * Reuses the existing 360° context read, scores it with the pure readiness
 * module, and records the assessment in the Agent Action Audit Log so the
 * governance story ("no agent action is silent") holds even for a read.
 */
export const handoffService = {
  /** Score one opportunity's readiness to hand off to delivery (CSA/CSAM). */
  async readiness(id: string) {
    const ctx = await opportunitiesService.context(id);
    if (!ctx) throw new HttpError(404, 'Opportunity not found.');

    const result = scoreHandoff(ctx);

    await recordAgentAction({
      agentName: 'system',
      actionType: 'Read',
      actionName: 'Handoff readiness checked',
      opportunityId: ctx.id,
      inputSummary: `Checked handoff readiness for ${ctx.opportunityBusinessId}`,
      outputSummary: `Score ${result.score}% — ${result.missing.length} missing: ${
        result.missing.map((m) => m.item).join(', ') || 'none'
      }`,
    });

    return result;
  },

  /**
   * Capability #2: check whether ONE milestone carries the CSA-critical handoff
   * info (customer intent, what was promised, deployment, BANT, who to contact)
   * and return a paste-ready description scaffold for the SE. Informational only
   * — it never blocks a save.
   */
  async milestoneReadiness(id: string) {
    const milestone = await prisma.opportunityMilestone.findFirst({
      where: { OR: [{ id }, { milestoneBusinessId: id }] },
      include: { opportunity: { include: { dealTeamMembers: true } } },
    });
    if (!milestone) throw new HttpError(404, 'Milestone not found.');

    const result = scoreMilestoneHandoff(milestone);

    await recordAgentAction({
      agentName: 'system',
      actionType: 'Read',
      actionName: 'Milestone handoff info checked',
      opportunityId: milestone.opportunityId,
      relatedMilestoneId: milestone.id,
      inputSummary: `Checked handoff info for ${milestone.milestoneBusinessId}`,
      outputSummary: `Score ${result.score}% — ${result.missing.length} missing: ${
        result.missing.map((m) => m.item).join(', ') || 'none'
      }`,
    });

    return result;
  },

  /**
   * Capability #3: assess whether an opportunity is ready to REQUEST ECIF (End
   * Customer Investment Funds) and what the next step is — the real prerequisites
   * (delivery partner, work scope, committed intent, the >$50K/two-milestone rule)
   * plus ratio-based funding guidance. Replaces the old dollar "estimate": Adam's
   * walkthrough showed the amount is out of the seller's control; the value is in
   * guiding the process. A transparent MOCK read that never touches real ECIF
   * Central / Deal Assistance. Audited as a Read so the governance story holds.
   */
  async ecifReadiness(id: string) {
    const ctx = await opportunitiesService.context(id);
    if (!ctx) throw new HttpError(404, 'Opportunity not found.');

    const result = assessEcifReadiness(ctx);

    await recordAgentAction({
      agentName: 'system',
      actionType: 'Read',
      actionName: 'ECIF readiness checked',
      opportunityId: ctx.id,
      inputSummary: `Checked ECIF request readiness for ${ctx.opportunityBusinessId}`,
      outputSummary: result.ready
        ? `Ready for ECIF request — all ${result.present.length} prerequisites met`
        : `Not ready — ${result.score}%; missing: ${result.missing.map((m) => m.item).join(', ') || 'none'}`,
    });

    return result;
  },
};
