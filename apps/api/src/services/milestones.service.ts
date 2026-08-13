import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/httpError.js';
import { genId } from '../lib/ids.js';
import { connectOpportunity } from '../lib/connect.js';
import { recordAgentAction } from '../lib/audit.js';
import { assertCompetitorForLostStatus } from '../lib/lostToCompetitor.js';
import { maybeNotifyManager, type MilestoneNotifyContext } from './managerNotifications.service.js';
import { milestoneCommitmentService, COMMITTED_VALUE } from './milestoneCommitment.service.js';
import type { z } from 'zod';
import type { createMilestoneSchema, updateMilestoneSchema } from '../validators/schemas.js';

type CreateInput = z.infer<typeof createMilestoneSchema>;
type UpdateInput = z.infer<typeof updateMilestoneSchema>;

/**
 * Extra context for a status-changing update: who is acting (for the Graph
 * manager-email side effect) and whether they acknowledged that email. Optional
 * so non-UI callers (e.g. the disabled in-app tool) simply never send.
 */
export type MilestoneUpdateContext = MilestoneNotifyContext;

/** Owns milestone CRUD, relationship checks, write auditing, and status side effects. */
export const milestonesService = {
  /** List milestones with compact parent-opportunity context. */
  async list(where: { opportunityId?: string; milestoneStatus?: string }) {
    const rows = await prisma.opportunityMilestone.findMany({
      where,
      orderBy: { milestoneBusinessId: 'asc' },
      include: { opportunity: { select: { id: true, opportunityName: true, customerName: true } } },
    });
    // Self-heal: commit any past-due milestone before returning it.
    const flipped = await milestoneCommitmentService.reconcile(rows);
    if (flipped.size) {
      for (const r of rows) if (flipped.has(r.id)) r.customerCommitment = COMMITTED_VALUE;
    }
    return rows;
  },

  /** Load one milestone and the related records used by its detail screen. */
  async get(id: string) {
    const milestone = await prisma.opportunityMilestone.findFirst({
      where: { OR: [{ id }, { milestoneBusinessId: id }] },
      include: {
        opportunity: true,
        statusHistories: { orderBy: { statusDate: 'desc' } },
        recommendations: true,
        approvalRequests: true,
        collaborationNotes: true,
      },
    });
    if (milestone) {
      // Self-heal: if the target date has passed while Committed, flip before returning.
      const flipped = await milestoneCommitmentService.reconcile([milestone]);
      if (flipped.has(milestone.id)) milestone.customerCommitment = COMMITTED_VALUE;
    }
    return milestone;
  },

  /** Create under an existing opportunity and audit the completed write. */
  async create(input: CreateInput) {
    const { opportunityName, milestoneBusinessId, estDate, blockedSince, expectedResolutionDate, lastUpdated, ...rest } = input;
    const opportunity = await prisma.opportunity.findUnique({ where: { opportunityName } });
    if (!opportunity) throw new HttpError(400, `Opportunity "${opportunityName}" was not found.`);

    // A milestone can only be created as "Lost To Competitor" with a competitor.
    assertCompetitorForLostStatus(input.milestoneStatus, input.competitorName);

    const milestone = await prisma.opportunityMilestone.create({
      data: {
        ...rest,
        milestoneBusinessId: milestoneBusinessId || genId('MS'),
        estDate: estDate ? new Date(estDate) : null,
        blockedSince: blockedSince ? new Date(blockedSince) : null,
        expectedResolutionDate: expectedResolutionDate ? new Date(expectedResolutionDate) : null,
        lastUpdated: lastUpdated ? new Date(lastUpdated) : null,
        opportunity: { connect: { opportunityName } },
      },
      include: { opportunity: { select: { id: true, opportunityName: true, customerName: true } } },
    });
    await recordAgentAction({
      agentName: input.createdBy ?? 'system',
      actionType: 'Create',
      actionName: 'Milestone created',
      opportunityId: opportunity.id,
      relatedMilestoneId: milestone.id,
      outputSummary: `Created ${milestone.milestoneBusinessId}`,
    });
    return milestone;
  },

  /** Apply a partial update, audit changed fields, then evaluate notification rules. */
  async update(id: string, input: UpdateInput, ctx?: MilestoneUpdateContext) {
    const existing = await prisma.opportunityMilestone.findFirst({
      where: { OR: [{ id }, { milestoneBusinessId: id }] },
    });
    if (!existing) throw new HttpError(404, 'Milestone not found.');

    // Enforce the "Lost To Competitor" competitor requirement on the resulting
    // record — but only when this write actually touches the status or the
    // competitor, so unrelated edits to a pre-existing lost milestone aren't
    // blocked. `undefined` means "field not provided" (leave as-is).
    const statusTouched = input.milestoneStatus !== undefined;
    const competitorTouched = input.competitorName !== undefined;
    if (statusTouched || competitorTouched) {
      const resultingStatus = statusTouched ? input.milestoneStatus : existing.milestoneStatus;
      const resultingCompetitor = competitorTouched ? input.competitorName : existing.competitorName;
      assertCompetitorForLostStatus(resultingStatus, resultingCompetitor);
    }

    const { estDate, blockedSince, expectedResolutionDate, lastUpdated, ...rest } = input;
    const milestone = await prisma.opportunityMilestone.update({
      where: { id: existing.id },
      data: {
        ...rest,
        estDate: estDate ? new Date(estDate) : undefined,
        blockedSince: blockedSince ? new Date(blockedSince) : undefined,
        expectedResolutionDate: expectedResolutionDate ? new Date(expectedResolutionDate) : undefined,
        lastUpdated: lastUpdated ? new Date(lastUpdated) : undefined,
      },
      include: { opportunity: { select: { id: true, opportunityName: true, customerName: true } } },
    });

    const changedFields = Object.keys(input).filter(
      (k) => (input as Record<string, unknown>)[k] !== undefined,
    );
    await recordAgentAction({
      agentName: input.createdBy ?? 'system',
      actionType: 'Update',
      actionName: 'Milestone updated',
      opportunityId: existing.opportunityId,
      relatedMilestoneId: milestone.id,
      inputSummary: `Updated ${existing.milestoneBusinessId}${
        changedFields.length ? ` (fields: ${changedFields.join(', ')})` : ''
      }`,
    });

    // Side effect: a real transition INTO "Lost To Competitor" notifies the
    // seller's manager (best-effort; guarded by the human acknowledgement).
    const managerEmail = await maybeNotifyManager(existing.milestoneStatus, milestone, ctx);

    return managerEmail ? { ...milestone, managerEmail } : milestone;
  },

  /** Deletes a milestone (status history cascades; other links are set to null). */
  async remove(id: string) {
    const existing = await prisma.opportunityMilestone.findFirst({
      where: { OR: [{ id }, { milestoneBusinessId: id }] },
    });
    if (!existing) throw new HttpError(404, 'Milestone not found.');

    await prisma.opportunityMilestone.delete({ where: { id: existing.id } });

    await recordAgentAction({
      agentName: 'system',
      actionType: 'Delete',
      actionName: 'Milestone deleted',
      opportunityId: existing.opportunityId,
      inputSummary: `Deleted ${existing.milestoneBusinessId} (${existing.milestoneName})`,
    });

    return { id, milestoneBusinessId: existing.milestoneBusinessId };
  },
};
