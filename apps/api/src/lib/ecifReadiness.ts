/**
 * ECIF readiness & process guidance (Capability #3, reframed).
 *
 * Replaces the old "guess a funding number" estimator. Adam's walkthrough of the
 * real ECIF (End Customer Investment Funds) process made clear the dollar amount
 * is largely out of the seller's control and the least useful output — the value
 * is in GUIDING the seller through the multi-system process (ECIF Central ->
 * Deal Assistance -> AWR -> finance -> PO). This module answers "is this
 * opportunity ready to request ECIF, and what is the next step?" using ONLY fields
 * already on the opportunity and its milestones — no new tables/columns and no
 * writes. It never touches real ECIF Central / Deal Assistance / OneAsk; it only
 * tells the seller what to prepare and where to go.
 *
 * Checks map to real process rules from the ECIF walkthrough:
 *  - Delivery partner identified — ECIF pays a partner to execute the work scope.
 *  - Work scope started          — deliverables (milestones) with due dates exist.
 *  - Committed customer intent    — do not fund exploratory deals.
 *  - >=2 milestones               — a request over $50K USD needs two+ milestones.
 * Plus funding guidance: the 10:1 (or 5:1 competitive) revenue-to-ECIF band and the
 * "Microsoft rarely funds 100%" cost-share reminder — i.e. how much is reasonable to
 * REQUEST, not a predicted quote.
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

/** Numeric value or 0 for null/undefined/NaN. */
function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Whole-dollar USD, e.g. 18000 -> "$18,000". */
function usd(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
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
  estimatedRevenue?: number | null;
  competitorName?: string | null;
  milestones?: EcifMilestone[];
}

/** A failing prerequisite, trimmed to what the caller/assistant should surface. */
export interface EcifMissingItem {
  item: string;
  whatsMissing: string;
  howToFix: string;
}

/** Ratio-based ECIF funding guidance (how much is reasonable to REQUEST). */
export interface EcifFundingGuidance {
  /** Deal value used for the ratio math (0 if unknown). */
  estimatedRevenueUsd: number;
  /** Reasonable ECIF to request at the standard 10:1 ratio (revenue / 10). */
  standardMaxUsd: number;
  /** Stretch ceiling in a competitive deal at 5:1 (revenue / 5); justification required. */
  competitiveMaxUsd: number;
  /** True when an opportunity competitor is on record (5:1 may apply). */
  competitive: boolean;
  /** Plain-language guidance sentence. */
  note: string;
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
  /** How much ECIF is reasonable to request, from the revenue ratio. */
  fundingGuidance: EcifFundingGuidance;
  /** The single most important next step, leading with Work Scope in ECIF Central. */
  nextAction: string;
  /** Mandatory mock disclaimer plus any data-quality notes. */
  caveats: string[];
}

/** One prerequisite check on the ECIF readiness checklist. */
interface Check {
  key: 'partner' | 'workScope' | 'committedIntent' | 'milestoneCount';
  item: string;
  whatsMissing: string;
  howToFix: string;
  passed: boolean;
}

/** Commitment values that count as real deployment intent (not exploratory). */
const COMMITTED = new Set(['Confirmed', 'Contracted']);
/** Delivery values that imply a partner will execute the work scope. */
const PARTNER_DELIVERY = new Set(['Partner', 'Joint']);
/** Standard revenue-to-ECIF ratio (10:1) — reasonable request ≈ revenue / 10. */
const STANDARD_RATIO = 10;
/** Competitive-deal ratio (5:1) — stretch ceiling ≈ revenue / 5, needs justification. */
const COMPETITIVE_RATIO = 5;
/** ECIF requests above this USD amount require at least two milestones. */
const LARGE_REQUEST_THRESHOLD = 50_000;

/** Round a dollar amount to the nearest $100 for tidy guidance figures. */
function round100(n: number): number {
  return Math.round(n / 100) * 100;
}

/**
 * Assess an opportunity's readiness to request ECIF and the next step.
 * Deterministic and side-effect free.
 */
export function assessEcifReadiness(ctx: EcifReadinessContext): EcifReadinessResult {
  const milestones = ctx.milestones ?? [];
  const revenue = num(ctx.estimatedRevenue);
  const competitive = has(ctx.competitorName);

  // Funding guidance (F): reasonable amounts to REQUEST, from the revenue ratio.
  const standardMaxUsd = round100(revenue / STANDARD_RATIO);
  const competitiveMaxUsd = round100(revenue / COMPETITIVE_RATIO);

  // The ">$50K needs >=2 milestones" rule keys off the likely request size. The
  // real amount lives in ECIF Central, so use the standard 10:1 band as the proxy.
  const largeRequest = standardMaxUsd > LARGE_REQUEST_THRESHOLD;

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

  // The two-milestone rule only applies when the likely request exceeds $50K (F).
  if (largeRequest) {
    checks.push({
      key: 'milestoneCount',
      item: 'At least two milestones (>$50K rule)',
      whatsMissing: `This deal's size implies an ECIF request above ${usd(
        LARGE_REQUEST_THRESHOLD,
      )}, which requires at least two milestones — only ${milestones.length} is on record.`,
      howToFix: 'Add at least one more milestone so the work scope has two or more milestones.',
      passed: milestones.length >= 2,
    });
  }

  const passedChecks = checks.filter((c) => c.passed);
  const failedChecks = checks.filter((c) => !c.passed);
  const score = checks.length ? Math.round((passedChecks.length / checks.length) * 100) : 0;
  const ready = failedChecks.length === 0;

  const missing: EcifMissingItem[] = failedChecks.map(({ item, whatsMissing, howToFix }) => ({
    item,
    whatsMissing,
    howToFix,
  }));

  const note =
    revenue > 0
      ? `At the standard 10:1 revenue-to-ECIF ratio, a ${usd(revenue)} deal supports up to about ${usd(
          standardMaxUsd,
        )} in ECIF.${
          competitive
            ? ` Because a competitor is on this deal, a 5:1 ratio (up to ~${usd(
                competitiveMaxUsd,
              )}) may be justified, but stretch/full funding needs written justification.`
            : ''
        } Microsoft rarely funds 100% — expect the partner and customer to share the cost.`
      : 'No deal value is recorded, so the reasonable ECIF amount cannot be sized. Add the estimated revenue to apply the 10:1 (or 5:1 competitive) ratio. Microsoft rarely funds 100% — expect the partner and customer to share the cost.';

  const fundingGuidance: EcifFundingGuidance = {
    estimatedRevenueUsd: revenue,
    standardMaxUsd,
    competitiveMaxUsd,
    competitive,
    note,
  };

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
    'Mock process guidance for planning only — this does not create or submit a real ECIF request, and the amounts are ratio-based guidance, not an official ECIF quote or approval.',
  ];
  if (revenue <= 0) {
    caveats.push('No deal value recorded — funding guidance amounts are unavailable until estimated revenue is set.');
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
    fundingGuidance,
    nextAction,
    caveats,
  };
}
