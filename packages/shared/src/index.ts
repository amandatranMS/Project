/**
 * Shared choice values for MSX Milestone Assistant (the controlled vocabularies).
 *
 * These are the single source of truth for dropdowns/filters in the web UI and for
 * Zod validation in the API. Values mirror the workbook exactly (SQLite has no
 * enums, so choice columns are Strings validated against these lists).
 *
 * UI tip: render values as-is (they are already plain language) but use
 * `choiceLabel()` so the blank sentinel "---" shows as "(None)".
 */

// ---- Opportunity ----
export const SOLUTION_AREAS = ['Modern Work', 'Security', 'Azure', 'AI Apps'] as const;
export const SALES_STAGES = [
  'Listen & Consult',
  'Inspire & Design',
  'Empower & Achieve',
  'Realize Value',
  'Manage & Optimize',
] as const;
export const OPPORTUNITY_STATUSES = ['Active', 'On Hold', 'Won', 'Lost', 'Closed'] as const;

// ---- Milestone ----
export const MILESTONE_STATUSES = [
  '---',
  'On Track',
  'At Risk',
  'Blocked',
  'Completed',
  'Cancelled',
  'Lost To Competitor',
  'Hygiene/Duplicate',
] as const;

/**
 * The single milestone status that triggers an executive-summary email to the
 * seller's manager. Kept as a shared constant so the API trigger and the web
 * pop-up compare against the exact same string (note the capital "T").
 */
export const LOST_TO_COMPETITOR = 'Lost To Competitor';
export const WORKLOADS = [
  'M365 Copilot for Microsoft 365',
  'Microsoft Sentinel',
  'Microsoft Purview',
  'Azure Migration',
  'Copilot Studio',
  'Defender XDR',
  'Teams Premium',
] as const;
export const CUSTOMER_COMMITMENTS = ['Uncommitted', 'Verbal', 'Committed', 'Contracted'] as const;
export const DELIVERED_BY = ['Microsoft', 'Partner', 'Customer', 'Joint'] as const;
export const MILESTONE_CATEGORIES = ['Production', 'Pilot', 'Workshop', 'Assessment', 'Deployment', 'Adoption'] as const;
export const AZURE_CAPACITY_TYPES = ['---', 'Azure Commit', 'MACC', 'Open', 'CSP', 'EA'] as const;
export const PREFERRED_AZURE_REGIONS = [
  'Canada Central',
  'Canada East',
  'East US',
  'West US',
  'West Europe',
  'North Europe',
] as const;
export const RISK_IMPACTS = ['High', 'Medium', 'Low'] as const;

// ---- Recommendation ----
export const PRIORITIES = ['High', 'Medium', 'Low'] as const;
export const CONFIDENCE_LEVELS = ['High', 'Medium', 'Low'] as const;
export const REVIEW_STATUSES = ['Pending', 'Approved', 'Rejected', 'Needs Changes'] as const;

// ---- Approval Request ----
export const APPROVAL_STATUSES = ['Pending', 'Approved', 'Rejected', 'Needs Changes'] as const;
export const REQUEST_STATUSES = ['Draft', 'Submitted', 'Completed', 'Failed', 'Blocked'] as const;

// ---- Agent notifications / runs / audit ----
export const SEVERITIES = ['Info', 'Warning', 'Critical'] as const;
export const RUN_TYPES = ['User-triggered', 'Scheduled', 'System-triggered'] as const;
export const RESULT_STATUSES = ['Success', 'Failed', 'Blocked'] as const;

export const AGENT_ACTION_TYPES = ['Read', 'Create', 'Update', 'Delete', 'Recommend', 'SubmitApproval', 'CreateMilestone', 'Denied'] as const;

/** Groups every controlled list for convenient consumption by the UI. */
export const CHOICES = {
  solutionArea: SOLUTION_AREAS,
  salesStage: SALES_STAGES,
  opportunityStatus: OPPORTUNITY_STATUSES,
  milestoneStatus: MILESTONE_STATUSES,
  workload: WORKLOADS,
  customerCommitment: CUSTOMER_COMMITMENTS,
  deliveredBy: DELIVERED_BY,
  milestoneCategory: MILESTONE_CATEGORIES,
  azureCapacityType: AZURE_CAPACITY_TYPES,
  preferredAzureRegion: PREFERRED_AZURE_REGIONS,
  riskImpact: RISK_IMPACTS,
  priority: PRIORITIES,
  confidence: CONFIDENCE_LEVELS,
  reviewStatus: REVIEW_STATUSES,
  approvalStatus: APPROVAL_STATUSES,
  requestStatus: REQUEST_STATUSES,
  severity: SEVERITIES,
  runType: RUN_TYPES,
  resultStatus: RESULT_STATUSES,
} as const;

/** Blank sentinel used by the workbook for "no value". */
export const BLANK_CHOICE = '---';

/** Renders a choice value as a plain-language UI label ("---" → "(None)"). */
export function choiceLabel(value?: string | null): string {
  if (value == null || value === '' || value === BLANK_CHOICE) return '(None)';
  return value;
}

/** Standard API error envelope. */
export interface ApiError {
  error: string;
  details?: unknown;
}
