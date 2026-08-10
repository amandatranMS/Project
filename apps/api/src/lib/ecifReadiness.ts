/**
 * ECIF readiness & process guidance (Capability #3).
 *
 * ECIF (End Customer Investment Funds) amounts are decided and ASSIGNED through the
 * real process (work scope -> approvals -> PO), so this feature deliberately does
 * NOT estimate, predict, or quote a funding amount. Its only job is to tell the
 * seller whether an opportunity is READY to request/route ECIF and what the next
 * step is, using ONLY fields already on the opportunity's milestones — no new
 * tables/columns and no writes. It never touches real ECIF Central / Deal
 * Assistance / OneAsk; it just tells the seller what to prepare and where to go.
 *
 * Prerequisite checks map to real process rules from Adam's walkthrough:
 *  - Delivery partner identified — ECIF pays a partner to execute the work scope.
 *  - Work scope started          — deliverables (milestones) with due dates exist.
 *  - Committed customer intent    — do not route ECIF to an exploratory deal.
 * A non-scored reminder covers the ">$50K request needs two+ milestones" rule; it
 * states the rule without estimating the (externally assigned) amount.
 *
 * Pure and side-effect free — safe to call from a read endpoint, the assistant, or
 * a scheduled scan.
 */

/** True when a value is present and not a workbook blank ("", null, "---"). */
function has(value: unknown): boolean {
  if (value == null) return false;
  const s = String(value).trim();
  return s !== '' && s !== '---';
}

/** A milestone as seen by the readiness checks (only the fields it reads). */
interface EcifMilestone {
  milestoneCategory?: string | null;
  deliveredBy?: string | null;
  partnerName?: string | null;
  customerCommitment?: string | null;
  estDate?: Date | string | null;
}

/** An opportunity-with-milestones as returned by opportunitiesService.context(). */
export interface EcifReadinessContext {
  id: string;
  opportunityBusinessId: string;
  opportunityName: string;
  milestones?: EcifMilestone[];
}

/** A failing prerequisite, trimmed to what the caller/assistant should surface. */
export interface EcifMissingItem {
  item: string;
  whatsMissing: string;
  howToFix: string;
}

export interface EcifReadinessResult {
  opportunityId: string;
  opportunityBusinessId: string;
  opportunityName: string;
  /** 0–100: share of prerequisites met. */
  score: number;
  /** True when every prerequisite is met (safe to start an ECIF request). */
  ready: boolean;
  /** Ready-made one-line answer that leads with readiness + what is still missing. */
  headline: string;
  /** The prerequisites still to satisfy — the important part. */
  missing: EcifMissingItem[];
  /** Prerequisites that already pass, as compact labels. */
  present: string[];
  /** The single most important next step, leading with Work Scope in ECIF Central. */
  nextAction: string;
  /** Mock disclaimer, the "no amount estimated" note, and any process reminders. */
  caveats: string[];
}

/** One prerequisite check on the ECIF readiness checklist. */
interface Check {
  key: 'partner' | 'workScope' | 'committedIntent';
  item: string;
  whatsMissing: string;
  howToFix: string;
  passed: boolean;
}

/** Commitment values that count as real deployment intent (not exploratory). */
const COMMITTED = new Set(['Confirmed', 'Contracted']);
/** Delivery values that imply a partner will execute the work scope. */
const PARTNER_DELIVERY = new Set(['Partner', 'Joint']);

/**
 * Assess an opportunity's readiness to request ECIF and the next step.
 * Deterministic, side-effect free, and never estimates a funding amount.
 */
export function assessEcifReadiness(ctx: EcifReadinessContext): EcifReadinessResult {
  const milestones = ctx.milestones ?? [];

  const hasPartner = milestones.some(
    (m) => PARTNER_DELIVERY.has(String(m.deliveredBy ?? '').trim()) || has(m.partnerName),
  );
  const hasWorkScope = milestones.some((m) => has(m.milestoneCategory) && has(m.estDate));
  const hasCommitted = milestones.some((m) => COMMITTED.has(String(m.customerCommitment ?? '').trim()));

  const checks: Check[] = [
    {
      key: 'partner',
      item: 'Delivery partner identified',
      whatsMissing:
        'No delivery partner is named. ECIF funds a partner to execute the work scope, so a request cannot proceed without one.',
      howToFix:
        'Identify and onboard a delivery partner, then set Delivered By = Partner (or Joint) and the partner name on the deployment milestone(s).',
      passed: hasPartner,
    },
    {
      key: 'workScope',
      item: 'Work scope started',
      whatsMissing:
        'No milestone has both a deliverable type (category) and a due date, so there is nothing to build the ECIF work scope from.',
      howToFix:
        'In ECIF Central, create the Work Scope: capture the partner deliverables as milestones, each with a category and a due date.',
      passed: hasWorkScope,
    },
    {
      key: 'committedIntent',
      item: 'Committed customer intent',
      whatsMissing:
        'No milestone shows committed customer intent, so the deal still looks exploratory. ECIF should back deployments the customer actually plans to do.',
      howToFix:
        'Confirm the customer plans to deploy and set a milestone customer commitment to Confirmed or Contracted.',
      passed: hasCommitted,
    },
  ];

  const passedChecks = checks.filter((c) => c.passed);
  const failedChecks = checks.filter((c) => !c.passed);
  const score = checks.length ? Math.round((passedChecks.length / checks.length) * 100) : 0;
  const ready = failedChecks.length === 0;

  const missing: EcifMissingItem[] = failedChecks.map(({ item, whatsMissing, howToFix }) => ({
    item,
    whatsMissing,
    howToFix,
  }));

  // Next action always teaches the correct process order: Work Scope first.
  const partnerFailed = failedChecks.some((c) => c.key === 'partner');
  const workScopeFailed = failedChecks.some((c) => c.key === 'workScope');
  let nextAction: string;
  if (partnerFailed) {
    nextAction =
      'Identify a delivery partner first — ECIF cannot be requested without a partner to execute the work scope. Then create the Work Scope in ECIF Central before opening the Deal Assistance tab.';
  } else if (workScopeFailed) {
    nextAction =
      'Start in ECIF Central and create the Work Scope (partner deliverables as milestones with due dates) BEFORE opening Deal Assistance — starting in Deal Assistance just sends you back to the work scope.';
  } else if (!ready) {
    nextAction = `Resolve the remaining prerequisite(s) — ${missing
      .map((m) => m.item)
      .join(', ')} — then confirm the Work Scope in ECIF Central and submit the ECIF request from the Deal Assistance tab.`;
  } else {
    nextAction =
      'Prerequisites look complete. Confirm the Work Scope in ECIF Central, then submit the ECIF request from the Deal Assistance tab (local vs global), and track it through the AWR review and finance approval.';
  }

  const headline = ready
    ? `Looks ready to start an ECIF request — all ${checks.length} prerequisites met.`
    : `Not ready for an ECIF request yet — ${score}% of prerequisites met. Still needed (${
        missing.length
      } of ${checks.length}): ${missing.map((m) => m.item).join(', ')}.`;

  const caveats: string[] = [
    'Mock process guidance for readiness only — this does not create or submit a real ECIF request, and it does not estimate the funding amount (ECIF amounts are assigned through the work scope and approval process).',
  ];
  if (milestones.length < 2) {
    caveats.push(
      `Reminder: if the assigned ECIF request is over $50,000 USD it must have at least two milestones — this opportunity currently has ${milestones.length}. Add another milestone if that applies.`,
    );
  }

  return {
    opportunityId: ctx.id,
    opportunityBusinessId: ctx.opportunityBusinessId,
    opportunityName: ctx.opportunityName,
    score,
    ready,
    headline,
    missing,
    present: passedChecks.map((c) => c.item),
    nextAction,
    caveats,
  };
}
