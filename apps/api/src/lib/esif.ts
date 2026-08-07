/**
 * ESIF funding estimate (Capability #3) — a MOCK planning heuristic.
 *
 * Kevin's point #6/#9: when a deal transitions, the delivery team (CSA/CSAM)
 * and their manager want an early "funding heads-up" — roughly how much
 * deployment/adoption investment funding (ESIF) could back the work, and
 * whether it flows through Microsoft or a partner. This lets them plan the
 * deployment path *before* the deal closes instead of discovering it cold.
 *
 * This is a transparent, deterministic estimate derived ONLY from fields that
 * already exist on the opportunity and its milestones — no new tables/columns
 * and no writes. It is explicitly NOT an official ESIF/ECIF quote or approval;
 * every result carries that caveat.
 *
 * Pure and side-effect free — safe to call from a read endpoint, the assistant,
 * or a scheduled scan.
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

/** A milestone as seen by the ESIF heuristic (only the fields it reads). */
interface EsifMilestone {
  milestoneName?: string | null;
  milestoneCategory?: string | null;
  fitCharge?: number | null;
  deliveredBy?: string | null;
  partnerName?: string | null;
  customerCommitment?: string | null;
}

/** An opportunity-with-milestones as returned by opportunitiesService.context(). */
export interface EsifContext {
  id: string;
  opportunityBusinessId: string;
  opportunityName: string;
  solutionArea?: string | null;
  salesStage?: string | null;
  estimatedRevenue?: number | null;
  milestones?: EsifMilestone[];
}

/** One transparent factor that fed the estimate. */
export interface EsifBasisItem {
  factor: string;
  detail: string;
}

export interface EsifEstimate {
  opportunityId: string;
  opportunityBusinessId: string;
  opportunityName: string;
  /** True when a non-zero funding amount could be estimated. */
  eligible: boolean;
  /** Estimated ESIF funding, whole USD, rounded to the nearest $100. */
  estimatedFundingUsd: number;
  currency: 'USD';
  /** Short path tag: "Partner-led" | "Joint" | "Microsoft-led" | "Customer-led" | "Path TBD". */
  pathLabel: string;
  /** Full sentence describing how funding would be routed. */
  recommendedPath: string;
  /** How much to trust the estimate given intent/charges/stage. */
  confidence: 'High' | 'Medium' | 'Low';
  /** Ready-made one-line answer for the CSA/manager. */
  headline: string;
  /** The factors that drove the number, for transparency. */
  basis: EsifBasisItem[];
  /** Mandatory mock disclaimer plus any data-quality notes. */
  caveats: string[];
}

/** Commitment values that count as real deployment intent (not exploratory). */
const COMMITTED = new Set(['Confirmed', 'Contracted']);

/** Later sales stages where funding planning is more reliable. */
const LATER_STAGES = new Set(['Empower & Achieve', 'Realize Value', 'Manage & Optimize']);

/**
 * Share of a milestone's services charge that ESIF might co-invest, by category.
 * Production is steady-state (not deployment-funded); unknown/blank uses DEFAULT_RATE.
 */
const CATEGORY_RATE: Record<string, number> = {
  Deployment: 0.2,
  Adoption: 0.15,
  Pilot: 0.15,
  Workshop: 0.1,
  Assessment: 0.1,
  Production: 0,
};
const DEFAULT_RATE = 0.1;

/** Solution-area weighting (Azure deployments tend to attract more funding, mock). */
const AREA_MULT: Record<string, number> = {
  Azure: 1.2,
  Security: 1.1,
  'AI Apps': 1.1,
  'Modern Work': 1.0,
};

/** Proxy when no fit charges exist: assume ~30% of deal value is fundable services. */
const SERVICES_SHARE_OF_REVENUE = 0.3;
/** Blended ESIF rate applied to the estimated-revenue proxy. */
const PROXY_RATE = 0.12;

function normalizeCategory(category?: string | null): string {
  return has(category) ? String(category).trim() : '';
}

function categoryRate(category?: string | null): number {
  const c = normalizeCategory(category);
  if (c === '') return DEFAULT_RATE;
  return CATEGORY_RATE[c] ?? DEFAULT_RATE;
}

/** Fundable = anything except a Production (steady-state) milestone. */
function isFundable(m: EsifMilestone): boolean {
  return normalizeCategory(m.milestoneCategory) !== 'Production';
}

interface DeliveryPath {
  pathLabel: string;
  recommendedPath: string;
}

/**
 * Decide how ESIF would be routed. `deliveredBy` is the authoritative signal
 * (partnerName is often populated as a co-sell "partner of record" even on
 * Microsoft-led delivery, so it is NOT used to infer a partner-led path — only
 * to name the partner once the path is known, or as a last-resort fallback).
 */
function resolvePath(fundable: EsifMilestone[]): DeliveryPath {
  const partners = Array.from(
    new Set(fundable.map((m) => (has(m.partnerName) ? String(m.partnerName).trim() : '')).filter(Boolean)),
  );
  const partnerSuffix = partners.length ? `: ${partners.join(', ')}` : '';
  const delivered = new Set(fundable.map((m) => String(m.deliveredBy ?? '').trim()).filter(Boolean));

  if (delivered.has('Partner')) {
    return {
      pathLabel: 'Partner-led',
      recommendedPath: `Partner-led — route ESIF to the delivery partner${partnerSuffix || ' (name the partner of record)'}.`,
    };
  }
  if (delivered.has('Joint')) {
    return {
      pathLabel: 'Joint',
      recommendedPath: `Joint delivery — split ESIF across Microsoft and the partner${partnerSuffix}.`,
    };
  }
  if (delivered.has('Microsoft')) {
    return {
      pathLabel: 'Microsoft-led',
      recommendedPath: `Microsoft-led — apply ESIF to the Microsoft-delivered deployment work${
        partners.length ? ` (partner of record: ${partners.join(', ')})` : ''
      }.`,
    };
  }
  if (delivered.has('Customer')) {
    return {
      pathLabel: 'Customer-led',
      recommendedPath: 'Customer-led — limited ESIF; fund adoption/enablement support only.',
    };
  }
  if (partners.length) {
    return {
      pathLabel: 'Partner-led',
      recommendedPath: `Delivery path unset, but a partner is named${partnerSuffix} — confirm partner-led delivery to route ESIF.`,
    };
  }
  return {
    pathLabel: 'Path TBD',
    recommendedPath: 'Delivery path not set — confirm Microsoft vs. partner delivery to route ESIF.',
  };
}

/**
 * Estimate the ESIF funding that could back an opportunity's deployment.
 * Deterministic and side-effect free.
 */
export function estimateEsif(ctx: EsifContext): EsifEstimate {
  const milestones = ctx.milestones ?? [];
  const fundable = milestones.filter(isFundable);
  const charged = fundable.filter((m) => num(m.fitCharge) > 0);
  const revenue = num(ctx.estimatedRevenue);

  // Weighted services-charge basis when charges exist; otherwise a revenue proxy.
  let base = 0;
  let usedProxy = false;
  if (charged.length > 0) {
    base = charged.reduce((sum, m) => sum + num(m.fitCharge) * categoryRate(m.milestoneCategory), 0);
  } else if (revenue > 0) {
    usedProxy = true;
    base = revenue * SERVICES_SHARE_OF_REVENUE * PROXY_RATE;
  }

  const areaMult = AREA_MULT[String(ctx.solutionArea ?? '').trim()] ?? 1.0;
  const estimatedFundingUsd = Math.round((base * areaMult) / 100) * 100;
  const eligible = estimatedFundingUsd > 0;

  const { pathLabel, recommendedPath } = resolvePath(fundable);

  const committedCount = fundable.filter((m) => COMMITTED.has(String(m.customerCommitment ?? ''))).length;
  const laterStage = LATER_STAGES.has(String(ctx.salesStage ?? '').trim());

  let confidence: EsifEstimate['confidence'] = 'Medium';
  if (!eligible || usedProxy) confidence = 'Low';
  else if (committedCount > 0 && charged.length > 0 && laterStage) confidence = 'High';
  else if (committedCount === 0) confidence = 'Low';

  const fundableCategories = Array.from(
    new Set(fundable.map((m) => normalizeCategory(m.milestoneCategory)).filter(Boolean)),
  );

  const basis: EsifBasisItem[] = [
    {
      factor: 'Fundable milestones',
      detail: `${fundable.length} of ${milestones.length}${
        fundableCategories.length ? ` (${fundableCategories.join(', ')})` : ''
      }`,
    },
    {
      factor: 'Funding basis',
      detail:
        charged.length > 0
          ? `${usd(charged.reduce((s, m) => s + num(m.fitCharge), 0))} in fit charges across ${
              charged.length
            } milestone(s), weighted by category`
          : usedProxy
            ? `${Math.round(SERVICES_SHARE_OF_REVENUE * 100)}% of ${usd(revenue)} estimated revenue (no charges recorded)`
            : 'No milestone charges or deal value recorded',
    },
    { factor: 'Solution area', detail: `${has(ctx.solutionArea) ? ctx.solutionArea : 'unset'} (×${areaMult})` },
    { factor: 'Delivery path', detail: pathLabel },
    { factor: 'Customer intent', detail: `${committedCount} milestone(s) Confirmed/Contracted` },
  ];

  const caveats: string[] = [
    'Mock heuristic for planning only — not an official ESIF/ECIF quote or funding approval.',
  ];
  if (usedProxy) caveats.push('No milestone fit charges recorded; amount derived from estimated revenue.');
  if (!eligible) caveats.push('Add milestone fit charges or a deal value to produce an estimate.');
  if (pathLabel === 'Path TBD' && eligible) {
    caveats.push('Delivery path unset — confirm Microsoft vs. partner before requesting funding.');
  }
  if (committedCount === 0) caveats.push('No committed customer intent yet — treat as exploratory.');
  if (fundable.some((m) => normalizeCategory(m.milestoneCategory) === '')) {
    caveats.push('Some milestones have no category; assumed deployment-related at a conservative rate.');
  }

  const headline = eligible
    ? `ESIF funding heads-up: ~${usd(estimatedFundingUsd)} could help fund this deployment (${pathLabel}, ${confidence} confidence).`
    : `No ESIF funding estimated yet for ${ctx.opportunityBusinessId} — add milestone fit charges or a deal value, and set a delivery path.`;

  return {
    opportunityId: ctx.id,
    opportunityBusinessId: ctx.opportunityBusinessId,
    opportunityName: ctx.opportunityName,
    eligible,
    estimatedFundingUsd,
    currency: 'USD',
    pathLabel,
    recommendedPath,
    confidence,
    headline,
    basis,
    caveats,
  };
}
