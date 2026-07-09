/**
 * Shared types for MSX Milestone Assistant. Field-name unions mirror the workbook
 * (the single source of truth). SQLite has no enums, so these are advisory and
 * used by the API (Zod) and the React frontend.
 */

export const OPPORTUNITY_STATUSES = ['Active', 'On Hold', 'Won', 'Lost', 'Closed'] as const;
export const SALES_STAGES = ['Listen & Consult', 'Inspire & Design', 'Empower & Achieve', 'Realize Value', 'Manage & Optimize'] as const;
export const SOLUTION_AREAS = ['Modern Work', 'Security', 'Azure', 'AI Apps'] as const;

export const MILESTONE_STATUSES = ['On Track', 'At Risk', 'Blocked', 'Completed', 'Lost to Competitor', 'Not Started'] as const;
export const RISK_IMPACTS = ['Low', 'Medium', 'High'] as const;

export const APPROVAL_STATUSES = ['Pending', 'Approved', 'Rejected'] as const;
export const REVIEW_STATUSES = ['Pending', 'Approved', 'Rejected'] as const;

export const AGENT_ACTION_TYPES = ['Read', 'Create', 'Update', 'Recommend', 'SubmitApproval', 'CreateMilestone', 'Denied'] as const;

/** Standard API error envelope. */
export interface ApiError {
  error: string;
  details?: unknown;
}
