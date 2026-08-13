import { prisma } from '../lib/prisma.js';
import { recordAgentAction } from '../lib/audit.js';

/**
 * Milestone commitment time-rule.
 *
 * A milestone's `customerCommitment` is a two-state flag (Committed / Uncommitted).
 * When a milestone that is still "Uncommitted" passes its target date (`estDate`), the
 * system automatically flips it to "Committed".
 *
 * This is a SYSTEM time-rule, not an agent action: it runs automatically (that is the
 * whole point) and is audited via `recordAgentAction`, but it is deliberately NOT
 * approval-gated — the human-in-the-loop approval gate covers agent-proposed changes,
 * not the passage of time. Every flip still lands in AgentActionAuditLog for governance.
 */

const COMMITTED = 'Committed';
const UNCOMMITTED = 'Uncommitted';

/**
 * Statuses that "freeze" a milestone's commitment. A milestone that is already
 * Completed/Cancelled/Lost/Hygiene has reached an end state, so a passed target date
 * must NOT change its commitment (e.g. a Cancelled milestone should not become Committed).
 */
const FROZEN_STATUSES = new Set(['Completed', 'Cancelled', 'Lost To Competitor', 'Hygiene/Duplicate']);

/** The minimal shape needed to evaluate and apply an auto-commit. */
export interface ReconcilableMilestone {
  id: string;
  milestoneBusinessId: string;
  customerCommitment: string | null;
  estDate: Date | null;
  milestoneStatus: string | null;
  opportunityId: string;
}

/** True when a milestone is still Uncommitted and its target date has already passed. */
export function shouldCommit(m: ReconcilableMilestone, now: Date = new Date()): boolean {
  return (
    m.customerCommitment === UNCOMMITTED &&
    m.estDate != null &&
    m.estDate.getTime() < now.getTime() &&
    !FROZEN_STATUSES.has(m.milestoneStatus ?? '')
  );
}

/** Apply the flip to a single milestone and audit it as a system action. */
async function flip(m: ReconcilableMilestone): Promise<void> {
  await prisma.opportunityMilestone.update({
    where: { id: m.id },
    data: { customerCommitment: COMMITTED },
  });
  await recordAgentAction({
    agentName: 'system',
    actionType: 'Update',
    actionName: 'Milestone auto-committed',
    opportunityId: m.opportunityId,
    relatedMilestoneId: m.id,
    inputSummary: `${m.milestoneBusinessId}: customer commitment Uncommitted → Committed (target date ${
      m.estDate ? m.estDate.toISOString().slice(0, 10) : 'unknown'
    } passed)`,
    outputSummary: 'Deadline passed while still Uncommitted; auto-set to Committed.',
    // System time-rule (no signed-in user); left unattributed like other agent rows.
    ownerId: null,
  });
}

export const milestoneCommitmentService = {
  shouldCommit,

  /**
   * Reconcile a batch of already-fetched milestones (a read self-heal path). Flips any
   * that are past-due and still Uncommitted, and returns the set of ids that changed so the
   * caller can patch the in-memory objects it is about to return.
   */
  async reconcile(milestones: ReconcilableMilestone[], now: Date = new Date()): Promise<Set<string>> {
    const flipped = new Set<string>();
    for (const m of milestones) {
      if (shouldCommit(m, now)) {
        await flip(m);
        flipped.add(m.id);
      }
    }
    return flipped;
  },

  /**
   * Sweep every Uncommitted, past-due milestone in the database and commit the live ones.
   * Runs once at startup and then on an interval (see startCommitmentSweep). Terminal
   * statuses are filtered in JS so null-status rows are handled correctly (SQL `NOT IN`
   * would drop them). Returns the number of milestones flipped.
   */
  async sweepPastDue(now: Date = new Date()): Promise<number> {
    const candidates = await prisma.opportunityMilestone.findMany({
      where: { customerCommitment: UNCOMMITTED, estDate: { lt: now } },
      select: {
        id: true,
        milestoneBusinessId: true,
        customerCommitment: true,
        estDate: true,
        milestoneStatus: true,
        opportunityId: true,
      },
    });
    const toFlip = candidates.filter((m) => shouldCommit(m, now));
    for (const m of toFlip) await flip(m);
    return toFlip.length;
  },
};

/** Value written back onto reconciled objects so callers don't need a re-fetch. */
export const COMMITTED_VALUE = COMMITTED;

/**
 * Starts the periodic commitment sweep. Runs immediately, then every `intervalMs`
 * (default 60s). The timer is unref'd so it never keeps the process alive on its own.
 * Returns the interval handle for tests/shutdown.
 */
export function startCommitmentSweep(intervalMs = 60_000): NodeJS.Timeout {
  const run = () => {
    milestoneCommitmentService
      .sweepPastDue()
      .then((n) => {
        if (n > 0) console.log(`⏱️  Auto-committed ${n} past-due milestone(s).`);
      })
      .catch((err) => {
        console.error('Commitment sweep failed:', err instanceof Error ? err.message : err);
      });
  };
  run();
  const handle = setInterval(run, intervalMs);
  if (typeof handle.unref === 'function') handle.unref();
  return handle;
}
