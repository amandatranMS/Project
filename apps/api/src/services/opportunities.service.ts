import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/httpError.js';
import { genId } from '../lib/ids.js';
import { recordAgentAction } from '../lib/audit.js';
import { milestoneCommitmentService, COMMITTED_VALUE } from './milestoneCommitment.service.js';
import type { AuthUser } from '../lib/entraAuth.js';
import { currentScopeWhere, type OwnerScopeWhere } from '../lib/requestContext.js';
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

/**
 * Related records for the agent's 360° context read.
 *
 * Approvals and audit rows are per-user, so they get the caller's owner filter
 * rather than being pulled in wholesale — the opportunity itself is shared, but
 * the agent activity hanging off it is not.
 */
function childInclude(scope: OwnerScopeWhere) {
  return {
    milestones: { orderBy: { milestoneBusinessId: 'asc' } },
    statusHistories: { orderBy: { statusDate: 'desc' } },
    recommendations: { orderBy: { recommendationBusinessId: 'asc' } },
    approvalRequests: { where: scope, orderBy: { approvalRequestBusinessId: 'asc' } },
    collaborationNotes: { orderBy: { createdOn: 'desc' } },
    dealTeamMembers: { orderBy: { dealTeamMemberBusinessId: 'asc' } },
    notifications: { orderBy: { createdDate: 'desc' } },
    runLogs: { orderBy: { runName: 'asc' } },
    auditLogs: { where: scope, orderBy: { createdAt: 'desc' } },
  } satisfies Prisma.OpportunityInclude;
}

/** Related records loaded for the opportunity detail screen. */
const detailInclude = {
  milestones: { orderBy: { milestoneBusinessId: 'asc' } },
  dealTeamMembers: true,
  collaborationNotes: { orderBy: { createdOn: 'desc' } },
  recommendations: { orderBy: { recommendationBusinessId: 'asc' } },
} as const;

/**
 * Build a Prisma `where` that resolves an opportunity from a human- or agent-supplied
 * reference in ANY reasonable format: the internal id, the business id (e.g. OPP-001 or a
 * runtime OPP-MSRO2XT3949), or the opportunity name. Matching is case-insensitive and
 * whitespace-trimmed, and tolerates a missing "OPP-" prefix on the business id, so the
 * same value works no matter how the user typed it.
 */
function opportunityRefWhere(term: string): Prisma.OpportunityWhereInput {
  const raw = term.trim();
  const ci = 'insensitive' as const;
  const idForms = /^opp-/i.test(raw) ? [raw] : [raw, `OPP-${raw}`];
  return {
    OR: [
      { id: raw },
      ...idForms.map((v) => ({ opportunityBusinessId: { equals: v, mode: ci } })),
      { opportunityName: { equals: raw, mode: ci } },
    ],
  };
}

/**
 * Resolve an opportunity reference (id, business id, or name — in any format) to the
 * internal id. Tries an exact/prefix-tolerant, case-insensitive match first, then falls
 * back to an unambiguous partial-name match (a single opportunity whose name contains the
 * term). Returns null when nothing matches or a partial term is ambiguous.
 */
async function resolveOpportunityId(term: string): Promise<string | null> {
  const raw = term.trim();
  if (!raw) return null;
  const exact = await prisma.opportunity.findFirst({
    where: opportunityRefWhere(raw),
    select: { id: true },
  });
  if (exact) return exact.id;
  if (raw.length < 3) return null;
  const partial = await prisma.opportunity.findMany({
    where: { opportunityName: { contains: raw, mode: 'insensitive' } },
    select: { id: true },
    take: 2,
  });
  return partial.length === 1 ? partial[0]!.id : null;
}

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

  /** Load the detail-screen projection by internal id, business id, or name (any format). */
  async get(ref: string) {
    const id = await resolveOpportunityId(ref);
    if (!id) return null;
    const opportunity = await prisma.opportunity.findUnique({
      where: { id },
      include: detailInclude,
    });
    // Self-heal the embedded milestone list: commit any that are now past-due.
    if (opportunity?.milestones?.length) {
      const flipped = await milestoneCommitmentService.reconcile(opportunity.milestones);
      if (flipped.size) {
        for (const m of opportunity.milestones) {
          if (flipped.has(m.id)) m.customerCommitment = COMMITTED_VALUE;
        }
      }
    }
    return opportunity;
  },

  /** Full 360° context: opportunity plus every related record. Resolves ref in any format. */
  async context(ref: string, user?: AuthUser) {
    const id = await resolveOpportunityId(ref);
    if (!id) return null;
    return prisma.opportunity.findUnique({
      where: { id },
      include: childInclude(currentScopeWhere(user)),
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

    // Audit the creation itself. The broadcast below only logs the visibility
    // notification, and is skipped entirely when notifications are disabled, so
    // without this the create would be silent — unlike update/remove.
    const actorLabel = actor?.email ?? (actor?.kind === 'service' ? 'foundry-agent (service)' : 'system');
    await recordAgentAction({
      agentName: actorLabel,
      actionType: 'Create',
      actionName: 'Opportunity created',
      actor: actorLabel,
      opportunityId: created.id,
      inputSummary: `Created ${created.opportunityBusinessId} (${created.opportunityName})`,
      outputSummary: `Created opportunity ${created.opportunityBusinessId}`,
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

  /**
   * Create-or-reuse for the human approval gate. `opportunityName` is @unique, so
   * re-approving a CreateOpportunity request whose opportunity was already created
   * (a prior approval that partially completed, or a duplicate queued request) must
   * not throw a unique-constraint error that surfaces as an opaque 500. When the
   * opportunity already exists we reuse it and still run the visibility broadcast so
   * the Teams notification goes out and the approval can complete cleanly.
   */
  async createForApproval(input: CreateInput, actor?: AuthUser, broadcast: BroadcastMode = 'send') {
    const existing = input.opportunityName
      ? await prisma.opportunity.findUnique({ where: { opportunityName: input.opportunityName } })
      : null;
    if (!existing) return opportunitiesService.create(input, actor, broadcast);

    const broadcastResult = await opportunityBroadcastService.onOpportunityCreated(existing, actor, broadcast);
    return { ...existing, teamsBroadcast: broadcastResult.teamsBroadcast, alreadyExisted: true as const };
  },

  async update(ref: string, input: UpdateInput, actor?: string) {
    // Resolve the opportunity from an id, business id, or name in any format so the
    // agent can target it the same way a human does.
    const resolvedId = await resolveOpportunityId(ref);
    const existing = resolvedId
      ? await prisma.opportunity.findUnique({ where: { id: resolvedId } })
      : null;
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
  async remove(ref: string, cascade: boolean) {
    const resolvedId = await resolveOpportunityId(ref);
    const existing = resolvedId
      ? await prisma.opportunity.findUnique({
          where: { id: resolvedId },
          include: { _count: { select: { milestones: true } } },
        })
      : null;
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
    await prisma.opportunity.delete({ where: { id: existing.id } });

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

    return { id: existing.id, opportunityBusinessId: existing.opportunityBusinessId, milestonesDeleted: milestoneCount };
  },
};
