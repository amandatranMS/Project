/**
 * Milestone-level handoff-info check (Capability #2, per Kevin's feedback).
 *
 * Kevin's core point: when a milestone is handed to CSU, the CSA often gets "a
 * blind date" — no customer intent, no deployment info, no explanation of what
 * was promised, no idea who to contact, and no BANT (Budget, Authority, Need,
 * Timeline). And intent matters more than the milestone title: buying a product
 * (e.g. Defender bundled in E5) does NOT mean the customer intends to deploy it.
 *
 * This module reads what a milestone (and its parent opportunity + deal team)
 * already captures and reports which CSA-critical items are present vs. missing,
 * WITHOUT gating anything — the goal is to make the SE aware. It also builds a
 * paste-ready description scaffold the SE can drop into the milestone so the
 * intent/BANT story travels with the milestone.
 *
 * Pure and side-effect free: no DB, no writes.
 */

import type { MissingItem } from './handoffReadiness.js';

/** True when a value is present and not a workbook blank ("", null, "---"). */
function has(value: unknown): boolean {
  if (value == null) return false;
  const s = String(value).trim();
  return s !== '' && s !== '---';
}

interface HandoffMilestoneOpportunity {
  businessProblem?: string | null;
  estimatedRevenue?: number | null;
  aeOwner?: string | null;
  customerName?: string | null;
  dealTeamMembers?: { personName?: string | null; role?: string | null; active?: boolean | null }[];
}

/** A milestone (with its parent opportunity + deal team) as seen by the checks. */
export interface HandoffMilestone {
  id: string;
  milestoneBusinessId: string;
  milestoneName: string;
  customerCommitment?: string | null;
  comments?: string | null;
  fitCharge?: number | null;
  owner?: string | null;
  workload?: string | null;
  estDate?: Date | string | null;
  deliveredBy?: string | null;
  milestoneCategory?: string | null;
  opportunity?: HandoffMilestoneOpportunity | null;
}

interface MilestoneCheck {
  key: string;
  item: string;
  whatsMissing: string;
  howToFix: string;
  passed: boolean;
}

export interface MilestoneHandoffResult {
  milestoneId: string;
  milestoneBusinessId: string;
  milestoneName: string;
  /** 0–100: share of the CSA-critical items captured. */
  score: number;
  /** True when every CSA-critical item is captured. */
  ready: boolean;
  /** One-line answer that leads with what's still missing. */
  headline: string;
  /** The CSA-critical items this milestone does NOT yet capture. */
  missing: MissingItem[];
  /** The items already captured, as compact labels. */
  present: string[];
  /** The fix action for each missing item, in order. */
  nextSteps: string[];
  /**
   * A ready-to-paste "CSA Handoff Notes" block for the milestone description
   * (the `comments` field). Known values are pre-filled; missing items are left
   * as <angle-bracket> prompts for the SE to complete.
   */
  suggestedDescription: string;
}

/** The commitment values that count as real deployment intent (not exploratory). */
const COMMITTED = new Set(['Committed']);

/** A milestone description is only "substantive" once it has some real content. */
const MIN_DESCRIPTION_LENGTH = 15;

function money(v?: number | null): string | null {
  return typeof v === 'number'
    ? v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
    : null;
}

/** `label: value` when known, else `label: <placeholder>` — for the scaffold. */
function line(label: string, known: string | null | undefined, placeholder: string): string {
  return has(known) ? `${label}: ${String(known).trim()}` : `${label}: <${placeholder}>`;
}

/** Compose the paste-ready CSA handoff notes block from what we know. */
function buildDescription(m: HandoffMilestone, contacts: string): string {
  const opp = m.opportunity ?? {};
  const intent = COMMITTED.has(String(m.customerCommitment ?? ''))
    ? `${m.customerCommitment} — confirm the customer actually plans to deploy`
    : null;
  const budget = money(m.fitCharge) ?? money(opp.estimatedRevenue);

  return [
    '[CSA Handoff Notes]',
    line('Customer intent', intent, 'real or exploratory? do they actually plan to deploy this?'),
    'What was promised: <what the SE committed to the customer>',
    line('Deployment', has(m.deliveredBy) ? `delivered by ${m.deliveredBy}` : null, 'who delivers: Microsoft / Partner / Customer / Joint'),
    'BANT:',
    `  - ${line('Budget', budget, 'funding source / amount')}`,
    `  - ${line('Authority (owns deployment)', m.owner, 'who owns deployment?')}`,
    `  - ${line('Need (why they want it)', opp.businessProblem ?? m.workload, 'business driver / problem being solved')}`,
    `  - ${line('Timeline', m.estDate ? String(m.estDate).slice(0, 10) : null, 'target date')}`,
    line('Who to contact', has(contacts) ? contacts : null, 'key contacts and roles'),
  ].join('\n');
}

/**
 * Score a milestone's handoff completeness and build a suggested description.
 * Deterministic and side-effect free.
 */
export function scoreMilestoneHandoff(m: HandoffMilestone): MilestoneHandoffResult {
  const opp = m.opportunity ?? {};
  const team = (opp.dealTeamMembers ?? []).filter((t) => t.active !== false);
  const contacts = team
    .map((t) => (t.personName ? `${t.personName}${t.role ? ` (${t.role})` : ''}` : t.role))
    .filter((x): x is string => Boolean(x))
    .join(', ');

  const checks: MilestoneCheck[] = [
    {
      key: 'intent',
      item: 'Customer intent',
      whatsMissing: 'The milestone does not record whether the customer actually plans to deploy (buying is not intent).',
      howToFix: 'Set the commitment to Committed and state real-vs-exploratory intent in the description.',
      passed: COMMITTED.has(String(m.customerCommitment ?? '')),
    },
    {
      key: 'promised',
      item: 'What was promised',
      whatsMissing: 'The description does not explain what was promised or the deployment context.',
      howToFix: 'Add a description covering what the SE committed to and any deployment details.',
      passed: has(m.comments) && String(m.comments).trim().length >= MIN_DESCRIPTION_LENGTH,
    },
    {
      key: 'budget',
      item: 'Budget / funding',
      whatsMissing: 'No funding is captured on the milestone or opportunity.',
      howToFix: 'Add a fit charge on the milestone, or the estimated revenue / funding source on the opportunity.',
      passed: (typeof m.fitCharge === 'number' && m.fitCharge > 0) ||
        (typeof opp.estimatedRevenue === 'number' && opp.estimatedRevenue > 0),
    },
    {
      key: 'authority',
      item: 'Authority (owns deployment)',
      whatsMissing: 'No owner is set, so it is unclear who is accountable for deployment.',
      howToFix: 'Set the milestone owner to whoever owns deployment.',
      passed: has(m.owner),
    },
    {
      key: 'need',
      item: 'Need (why they want it)',
      whatsMissing: 'No business problem or workload explains why the customer wants this.',
      howToFix: 'Set the workload, or capture the business problem on the opportunity.',
      passed: has(opp.businessProblem) || has(m.workload),
    },
    {
      key: 'timeline',
      item: 'Timeline',
      whatsMissing: 'No target date is set, so the CSA cannot see the timeline.',
      howToFix: 'Set the estimated date on the milestone.',
      passed: has(m.estDate),
    },
    {
      key: 'deployment',
      item: 'Deployment details',
      whatsMissing: 'It is unclear who delivers this (Microsoft, partner, customer, or joint).',
      howToFix: 'Set "delivered by" on the milestone.',
      passed: has(m.deliveredBy),
    },
    {
      key: 'contacts',
      item: 'Who to contact',
      whatsMissing: 'No deal-team contacts are listed for the CSA to reach out to.',
      howToFix: 'Add the key people (and roles) to the opportunity deal team.',
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
    ? `This milestone captures all ${checks.length} CSA-critical handoff items (100%).`
    : `Milestone handoff info is ${score}% complete. Consider adding (${missing.length} of ${checks.length}): ${
        missing.map((x) => x.item).join(', ')
      }.`;

  return {
    milestoneId: m.id,
    milestoneBusinessId: m.milestoneBusinessId,
    milestoneName: m.milestoneName,
    score,
    ready: failedChecks.length === 0,
    headline,
    missing,
    present: passedChecks.map((c) => c.item),
    nextSteps: missing.map((x) => x.howToFix),
    suggestedDescription: buildDescription(m, contacts),
  };
}
