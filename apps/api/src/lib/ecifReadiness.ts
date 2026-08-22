/**
 * ECIF readiness & process guidance.
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
 * A non-scored reminder covers the ">$50K request needs two+ milestones" rule; it
 * states the rule without estimating the (externally assigned) amount.
 *
 * On top of readiness it emits two deterministic, non-costed aids: a Local-vs-Global
 * `requestType` hint (from the partner/workload spread across milestones) and a
 * ready-to-paste `workScopeDraft` assembled from fields already on the opportunity —
 * both cut the manual re-entry Adam flagged, and neither introduces a funding amount.
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

/** A milestone as seen by the readiness checks + work-scope draft (only the fields it reads). */
interface EcifMilestone {
  milestoneBusinessId?: string | null;
  milestoneName?: string | null;
  workload?: string | null;
  milestoneCategory?: string | null;
  deliveredBy?: string | null;
  partnerName?: string | null;
  estDate?: Date | string | null;
}

/** An opportunity-with-milestones as returned by opportunitiesService.context(). */
export interface EcifReadinessContext {
  id: string;
  opportunityBusinessId: string;
  opportunityName: string;
  tpid?: string | null;
  customerName?: string | null;
  solutionArea?: string | null;
  milestones?: EcifMilestone[];
}

/** A failing prerequisite, trimmed to what the caller/assistant should surface. */
export interface EcifMissingItem {
  item: string;
  whatsMissing: string;
  howToFix: string;
}

/** A deterministic Local-vs-Global request-type hint (not a funding decision). */
export interface EcifRequestTypeSuggestion {
  /** Suggested ECIF request type based on the partner/workload spread. */
  suggestion: 'Local' | 'Global';
  /** Plain-language why, naming the partners/workloads that drove the call. */
  reason: string;
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
  /** Deterministic Local-vs-Global hint from the partner/workload spread (no amount). */
  requestType: EcifRequestTypeSuggestion;
  /** Ready-to-paste ECIF Work Scope draft built from existing fields (no amount). */
  workScopeDraft: string;
  /** Mock disclaimer, the "no amount estimated" note, and any process reminders. */
  caveats: string[];
}

/** One prerequisite check on the ECIF readiness checklist. */
interface Check {
  key: 'partner' | 'workScope';
  item: string;
  whatsMissing: string;
  howToFix: string;
  passed: boolean;
}

/** Delivery values that imply a partner will execute the work scope. */
const PARTNER_DELIVERY = new Set(['Partner', 'Joint']);

/** Format a workbook date as YYYY-MM-DD, or an em dash when absent/unparseable. */
function fmtDate(value?: Date | string | null): string {
  if (!has(value)) return '—';
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 10);
}

/** Distinct, non-blank, trimmed values of a milestone field. */
function distinct(milestones: EcifMilestone[], pick: (m: EcifMilestone) => unknown): string[] {
  const out = new Set<string>();
  for (const m of milestones) {
    const v = pick(m);
    if (has(v)) out.add(String(v).trim());
  }
  return [...out];
}

/**
 * Suggest a Local vs Global ECIF request type from the partner/workload spread.
 * Global is for splitting funds across multiple delivery partners (Adam's PWC +
 * Blue Voyant example); a single partner/workload is typically Local. This is a
 * process hint only — it never implies or estimates a funding amount.
 */
function suggestRequestType(milestones: EcifMilestone[]): EcifRequestTypeSuggestion {
  const partners = distinct(milestones, (m) => m.partnerName);
  const workloads = distinct(milestones, (m) => m.workload);

  if (partners.length > 1) {
    return {
      suggestion: 'Global',
      reason: `Multiple delivery partners across milestones (${partners.join(
        ', ',
      )}), so a Global ECIF request lets you split the funds per partner/workload.`,
    };
  }
  if (workloads.length > 1) {
    return {
      suggestion: 'Local',
      reason: `One partner spans ${workloads.length} workloads (${workloads.join(
        ', ',
      )}); a Local ECIF request fits. Switch to Global if separate partners take each workload, so the funds can be divided.`,
    };
  }
  return {
    suggestion: 'Local',
    reason:
      'At most one partner and workload so far, so plan for a Local ECIF request; switch to Global if you add more partners (Global splits the funds per partner).',
  };
}

/**
 * Assemble a ready-to-paste ECIF Work Scope draft from fields already on the
 * opportunity + milestones, so the seller does not re-type them into ECIF Central.
 * Purely a formatting aid — it contains no funding amount and writes nothing.
 */
function buildWorkScopeDraft(
  ctx: EcifReadinessContext,
  requestType: EcifRequestTypeSuggestion,
  partnerLabel: string,
): string {
  const milestones = ctx.milestones ?? [];
  const idLine = has(ctx.tpid)
    ? `${ctx.opportunityBusinessId} · TPID ${String(ctx.tpid).trim()}`
    : ctx.opportunityBusinessId;

  const lines: string[] = [
    `ECIF Work Scope draft — ${ctx.opportunityName} (${idLine})`,
    `Customer: ${has(ctx.customerName) ? String(ctx.customerName).trim() : '—'}`,
    `Solution area: ${has(ctx.solutionArea) ? String(ctx.solutionArea).trim() : '—'}`,
    `Delivery partner: ${partnerLabel}`,
    `Suggested request type: ${requestType.suggestion} — ${requestType.reason}`,
    '',
    'Proposed work-scope milestones (partner deliverables):',
  ];

  if (milestones.length === 0) {
    lines.push(
      '  (none yet) — add partner deliverables as milestones, each with a category and a due date, to build the work scope.',
    );
  } else {
    milestones.forEach((m, i) => {
      const name = has(m.milestoneName) ? String(m.milestoneName).trim() : `Milestone ${i + 1}`;
      const idTag = has(m.milestoneBusinessId) ? ` [${String(m.milestoneBusinessId).trim()}]` : '';
      const deliverable = has(m.milestoneCategory) ? String(m.milestoneCategory).trim() : '—';
      const workload = has(m.workload) ? String(m.workload).trim() : '—';
      const owner = has(m.partnerName)
        ? String(m.partnerName).trim()
        : PARTNER_DELIVERY.has(String(m.deliveredBy ?? '').trim())
          ? String(m.deliveredBy).trim()
          : '—';
      lines.push(
        `  ${i + 1}. ${name}${idTag} — Deliverable: ${deliverable}; Due: ${fmtDate(
          m.estDate,
        )}; Workload: ${workload}; Partner: ${owner}`,
      );
    });
  }

  lines.push(
    '',
    'Prepared from mock MSX data. Paste into the ECIF Central Work Scope, then submit via Deal Assistance. No funding amount is included — ECIF amounts are assigned through the approval process.',
  );

  return lines.join('\n');
}

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

  // #2 Local-vs-Global hint and #1 ready-to-paste Work Scope draft — both are
  // deterministic aids built from existing fields and never carry a funding amount.
  const requestType = suggestRequestType(milestones);
  const partnerNames = distinct(milestones, (m) => m.partnerName);
  const partnerLabel = partnerNames.length
    ? partnerNames.join(', ')
    : hasPartner
      ? 'Partner-delivered (set the partner name on the milestone)'
      : '— identify a delivery partner —';
  const workScopeDraft = buildWorkScopeDraft(ctx, requestType, partnerLabel);

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
  } else {
    nextAction =
      `Prerequisites look complete. Confirm the Work Scope in ECIF Central, then submit the ECIF request from the Deal Assistance tab (suggested request type: ${requestType.suggestion}), and track it through the AWR review and finance approval.`;
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
    requestType,
    workScopeDraft,
    caveats,
  };
}
