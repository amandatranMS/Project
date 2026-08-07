/**
 * Handoff readiness scoring (Capability #1).
 *
 * Pure, dependency-free assessment of whether an opportunity is ready to hand off
 * from the pre-sales team (AE/SE) to the delivery team (CSA/CSAM). It ONLY reads
 * fields that already exist on the opportunity and its milestones/notes/deal team,
 * so it needs no new tables or columns and performs no writes.
 *
 * The seven checks mirror the "blind handoff" pain points: is the customer's
 * intent real, is there budget, who owns it, what's the need, when does it close,
 * is there evidence of what was sold, and do we know who to contact.
 */

/** True when a value is present and not a workbook blank ("", null, "---"). */
function has(value: unknown): boolean {
  if (value == null) return false;
  const s = String(value).trim();
  return s !== '' && s !== '---';
}

/** A milestone as seen by the readiness checks (only the fields it reads). */
interface ReadinessMilestone {
  customerCommitment?: string | null;
  fitCharge?: number | null;
  estDate?: Date | string | null;
  workload?: string | null;
  comments?: string | null;
  owner?: string | null;
}

/** An opportunity-with-children as returned by opportunitiesService.context(). */
export interface ReadinessContext {
  id: string;
  opportunityBusinessId: string;
  opportunityName: string;
  customerName?: string | null;
  estimatedRevenue?: number | null;
  closeDate?: Date | string | null;
  aeOwner?: string | null;
  assignedSE?: string | null;
  businessProblem?: string | null;
  milestones?: ReadinessMilestone[];
  collaborationNotes?: unknown[];
  dealTeamMembers?: { role?: string | null; personName?: string | null }[];
}

/** One check on the readiness checklist. */
export interface ReadinessCheck {
  key: 'intent' | 'budget' | 'authority' | 'need' | 'timeline' | 'evidence' | 'contacts';
  /** Short human label, e.g. "Customer intent". */
  item: string;
  /** Why the check fails (only meaningful when passed = false). */
  whatsMissing: string;
  /** The concrete action that would make it pass. */
  howToFix: string;
  passed: boolean;
}

/** A failing check, trimmed to the fields the caller/assistant should surface. */
export interface MissingItem {
  item: string;
  whatsMissing: string;
  howToFix: string;
}

export interface ReadinessResult {
  opportunityId: string;
  opportunityBusinessId: string;
  opportunityName: string;
  /** 0–100: share of checks that passed. */
  score: number;
  /** True when nothing is missing (safe to hand off). */
  ready: boolean;
  /** Ready-made one-line answer that leads with what is still missing. */
  headline: string;
  /** What still needs to be filled in before handoff — the important part. */
  missing: MissingItem[];
  /** Checks that already pass, as compact labels. */
  present: string[];
  /** The fix action for each missing item, in order. */
  nextSteps: string[];
}

/** The committed-intent values that count as a real deal (not exploratory). */
const COMMITTED = new Set(['Committed', 'Contracted']);

/**
 * Score an opportunity's handoff readiness from data already on the record.
 * Deterministic and side-effect free — safe to call from a read endpoint, the
 * assistant, or a scheduled scan.
 */
export function scoreHandoff(ctx: ReadinessContext): ReadinessResult {
  const milestones = ctx.milestones ?? [];
  const notes = ctx.collaborationNotes ?? [];
  const team = ctx.dealTeamMembers ?? [];

  const checks: ReadinessCheck[] = [
    {
      key: 'intent',
      item: 'Customer intent',
      whatsMissing: 'No milestone shows committed customer intent.',
      howToFix: 'Confirm the customer plans to deploy and set a milestone commitment to Committed or Contracted.',
      passed: milestones.some((m) => COMMITTED.has(String(m.customerCommitment ?? ''))),
    },
    {
      key: 'budget',
      item: 'Budget / funding',
      whatsMissing: 'No deal value or milestone charge is recorded.',
      howToFix: 'Add the estimated revenue on the opportunity, or a fit charge on a milestone.',
      passed: (typeof ctx.estimatedRevenue === 'number' && ctx.estimatedRevenue > 0) ||
        milestones.some((m) => typeof m.fitCharge === 'number' && m.fitCharge > 0),
    },
    {
      key: 'authority',
      item: 'Authority / owner',
      whatsMissing: 'No account owner or deal-team member is on record.',
      howToFix: 'Set the AE owner, or add the decision-maker to the deal team.',
      passed: has(ctx.aeOwner) || team.length > 0,
    },
    {
      key: 'need',
      item: 'Business need',
      whatsMissing: 'No business problem or workload is captured.',
      howToFix: 'Note why the customer is buying, or set a workload on a milestone.',
      passed: has(ctx.businessProblem) || milestones.some((m) => has(m.workload)),
    },
    {
      key: 'timeline',
      item: 'Timeline',
      whatsMissing: 'No close date or milestone target date is set.',
      howToFix: 'Add the expected close date, or target dates on the milestones.',
      passed: has(ctx.closeDate) || milestones.some((m) => has(m.estDate)),
    },
    {
      key: 'evidence',
      item: 'Evidence of what was sold',
      whatsMissing: 'No notes or milestone comments capture what was promised.',
      howToFix: 'Attach what was promised — add a collaboration note or milestone comments (decks, recordings, notes).',
      passed: notes.length > 0 || milestones.some((m) => has(m.comments)),
    },
    {
      key: 'contacts',
      item: 'Who to contact',
      whatsMissing: 'No deal-team members are listed.',
      howToFix: 'Add the people the CSA should contact to the deal team.',
      passed: team.length > 0,
    },
  ];

  const passedChecks = checks.filter((c) => c.passed);
  const failedChecks = checks.filter((c) => !c.passed);
  const score = Math.round((passedChecks.length / checks.length) * 100);

  const missing: MissingItem[] = failedChecks.map(({ item, whatsMissing, howToFix }) => ({
    item,
    whatsMissing,
    howToFix,
  }));

  const headline = failedChecks.length === 0
    ? `Ready to hand off — all ${checks.length} checks passed (100%).`
    : `Not ready to hand off — ${score}% ready. Still needed (${missing.length} of ${checks.length}): ${
        missing.map((m) => m.item).join(', ')
      }.`;

  return {
    opportunityId: ctx.id,
    opportunityBusinessId: ctx.opportunityBusinessId,
    opportunityName: ctx.opportunityName,
    score,
    ready: failedChecks.length === 0,
    headline,
    missing,
    present: passedChecks.map((c) => c.item),
    nextSteps: missing.map((m) => m.howToFix),
  };
}
