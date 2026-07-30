import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/httpError.js';
import { genId } from '../lib/ids.js';
import { recordAgentAction } from '../lib/audit.js';
import type { AuthUser } from '../lib/entraAuth.js';
import { opportunityBroadcastService, type BroadcastMode } from './opportunityBroadcast.service.js';
import type { z } from 'zod';
import type { createOpportunitySchema, updateOpportunitySchema } from '../validators/schemas.js';

type CreateInput = z.infer<typeof createOpportunitySchema>;
type UpdateInput = z.infer<typeof updateOpportunitySchema>;

const TPID_PREFIX = 'TPID-';
const TPID_START = 1001;

/**
 * Next sequential business TPID for a new opportunity (e.g. TPID-1001 → TPID-1002).
 * Scans existing `TPID-<n>` values, takes the highest number, and returns the next
 * one; numbering starts at TPID-1001 when none exist yet. Values in other formats
 * are ignored. Not guaranteed collision-proof under truly concurrent creates
 * (this is an effectively single-writer mock app), which is acceptable here.
 */
async function computeNextTpid(): Promise<string> {
  const rows = await prisma.opportunity.findMany({
    where: { tpid: { startsWith: TPID_PREFIX } },
    select: { tpid: true },
  });
  let max = TPID_START - 1;
  for (const { tpid } of rows) {
    const match = /^TPID-(\d+)$/.exec(tpid ?? '');
    if (match) {
      const n = Number(match[1]);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return `${TPID_PREFIX}${max + 1}`;
}

const childInclude = {
  milestones: { orderBy: { milestoneBusinessId: 'asc' } },
  statusHistories: { orderBy: { statusDate: 'desc' } },
  recommendations: { orderBy: { recommendationBusinessId: 'asc' } },
  approvalRequests: { orderBy: { approvalRequestBusinessId: 'asc' } },
  collaborationNotes: { orderBy: { createdOn: 'desc' } },
  dealTeamMembers: { orderBy: { dealTeamMemberBusinessId: 'asc' } },
  notifications: { orderBy: { createdDate: 'desc' } },
  runLogs: { orderBy: { runName: 'asc' } },
  auditLogs: { orderBy: { createdAt: 'desc' } },
} as const;

/** Owns opportunity persistence, related-record views, broadcasts, and write auditing. */
export const opportunitiesService = {
  /** List filtered opportunities with milestone counts for summary screens. */
  list(where: { status?: string; salesStage?: string; solutionArea?: string }) {
    return prisma.opportunity.findMany({
      where,
      orderBy: { opportunityBusinessId: 'asc' },
      include: { _count: { select: { milestones: true } } },
    });
  },

  /** Load the detail-screen projection by internal id or workbook business id. */
  get(id: string) {
    // Accept either the internal id or the business id (e.g. "OPP-002").
    return prisma.opportunity.findFirst({
      where: { OR: [{ id }, { opportunityBusinessId: id }] },
      include: {
        milestones: { orderBy: { milestoneBusinessId: 'asc' } },
        dealTeamMembers: true,
        collaborationNotes: { orderBy: { createdOn: 'desc' } },
        recommendations: { orderBy: { recommendationBusinessId: 'asc' } },
      },
    });
  },

  /** Full 360° context: opportunity plus every related record. */
  context(id: string) {
    // Accept either the internal id or the business id (e.g. "OPP-002").
    return prisma.opportunity.findFirst({
      where: { OR: [{ id }, { opportunityBusinessId: id }] },
      include: childInclude,
    });
  },

  /** Preview the next auto-assigned sequential TPID (used by the create form). */
  nextTpid(): Promise<string> {
    return computeNextTpid();
  },

  async create(input: CreateInput, actor?: AuthUser, broadcast: BroadcastMode = 'none') {
    const { opportunityBusinessId, closeDate, lastUpdated, tpid, ...rest } = input;
    const created = await prisma.opportunity.create({
      data: {
        ...rest,
        // Auto-assign the next sequential TPID when the caller didn't supply one, so
        // every new opportunity is stamped TPID-<next> (e.g. TPID-1001 → TPID-1002).
        tpid: tpid?.trim() ? tpid.trim() : await computeNextTpid(),
        opportunityBusinessId: opportunityBusinessId || genId('OPP'),
        closeDate: closeDate ? new Date(closeDate) : null,
        lastUpdated: lastUpdated ? new Date(lastUpdated) : null,
      },
    });

    // "Notify the team of a new opportunity" broadcast. Always records the
    // in-app notification; the `broadcast` mode decides how Teams is handled — 'none'
    // (human form, web modal drives it), 'queue' (direct agent create → approval-gated),
    // or 'send' (already-approved CreateOpportunity → posted directly). Delivery
    // outcomes are returned so the approval UI can distinguish live, simulated,
    // partial, and failed broadcasts.
    const broadcastResult = await opportunityBroadcastService.onOpportunityCreated(created, actor, broadcast);
    return { ...created, teamsBroadcast: broadcastResult.teamsBroadcast };
  },

  async update(id: string, input: UpdateInput, actor?: string) {
    // Accept either the internal id or the business id (e.g. "OPP-002") so the
    // agent can target an opportunity the same way a human does.
    const existing = await prisma.opportunity.findFirst({
      where: { OR: [{ id }, { opportunityBusinessId: id }] },
    });
    if (!existing) throw new HttpError(404, 'Opportunity not found.');
    const { closeDate, lastUpdated, ...rest } = input;
    const opportunity = await prisma.opportunity.update({
      where: { id: existing.id },
      data: {
        ...rest,
        closeDate: closeDate ? new Date(closeDate) : undefined,
        lastUpdated: lastUpdated ? new Date(lastUpdated) : undefined,
      },
    });

    const changedFields = Object.keys(input).filter(
      (k) => (input as Record<string, unknown>)[k] !== undefined,
    );
    await recordAgentAction({
      agentName: actor ?? 'system',
      actionType: 'Update',
      actionName: 'Opportunity updated',
      opportunityId: existing.id,
      inputSummary: `Updated ${existing.opportunityBusinessId}${
        changedFields.length ? ` (fields: ${changedFields.join(', ')})` : ''
      }`,
    });

    return opportunity;
  },

  /**
   * Deletes an opportunity. Blocks by default when it still has milestones;
   * pass cascade=true to remove the opportunity and all its related records.
   */
  async remove(id: string, cascade: boolean) {
    const existing = await prisma.opportunity.findUnique({
      where: { id },
      include: { _count: { select: { milestones: true } } },
    });
    if (!existing) throw new HttpError(404, 'Opportunity not found.');

    const milestoneCount = existing._count.milestones;
    if (milestoneCount > 0 && !cascade) {
      throw new HttpError(
        409,
        `This opportunity has ${milestoneCount} milestone(s). Remove them first, or confirm a cascade delete to remove the opportunity and all related records.`,
      );
    }

    // The Prisma schema cascades milestones, notes and deal-team members, and
    // sets related recommendations/approvals/notifications/logs to null.
    await prisma.opportunity.delete({ where: { id } });

    await recordAgentAction({
      agentName: 'system',
      actionType: 'Delete',
      actionName: cascade && milestoneCount > 0 ? 'Opportunity deleted (cascade)' : 'Opportunity deleted',
      inputSummary: `Deleted ${existing.opportunityBusinessId} (${existing.opportunityName})`,
      outputSummary:
        milestoneCount > 0
          ? `Also removed ${milestoneCount} milestone(s) and related records`
          : 'No milestones were attached',
    });

    return { id, opportunityBusinessId: existing.opportunityBusinessId, milestonesDeleted: milestoneCount };
  },
};
