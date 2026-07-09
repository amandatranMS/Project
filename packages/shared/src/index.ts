/**
 * Shared TypeScript types for MSX Milestone Assistant.
 *
 * These string-literal unions mirror the documented allowed values for the
 * String status/type columns in prisma/schema.prisma. They are consumed by both
 * the API (Zod validation) and the React frontend.
 */

// ---- Opportunity ----
export const CUSTOMER_SEGMENTS = ['Enterprise', 'Commercial', 'SMB', 'Public Sector'] as const;
export type CustomerSegment = (typeof CUSTOMER_SEGMENTS)[number];

export const DEAL_STAGES = ['Qualify', 'Develop', 'Propose', 'Commit', 'Closed Won', 'Closed Lost'] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

export const OPPORTUNITY_STATUSES = ['Open', 'On Hold', 'Won', 'Lost'] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

export const PARTNER_TYPES = ['ISV', 'SI', 'Reseller', 'None'] as const;
export type PartnerType = (typeof PARTNER_TYPES)[number];

export const THREAT_LEVELS = ['Low', 'Medium', 'High'] as const;
export type ThreatLevel = (typeof THREAT_LEVELS)[number];

export const RISK_LEVELS = ['Low', 'Medium', 'High'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

// ---- Milestone ----
export const MILESTONE_TYPES = ['Technical Win', 'POC', 'Architecture Review', 'Security Review', 'Deployment', 'Custom'] as const;
export type MilestoneType = (typeof MILESTONE_TYPES)[number];

export const MILESTONE_STATUSES = ['Not Started', 'In Progress', 'Blocked', 'At Risk', 'Completed', 'Cancelled'] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const BLOCKER_STATUSES = ['None', 'Open', 'Mitigating', 'Resolved'] as const;
export type BlockerStatus = (typeof BLOCKER_STATUSES)[number];

// ---- Recommendation / Approval ----
export const RECOMMENDATION_TYPES = ['Next Milestone', 'Risk Mitigation', 'Status Change', 'Deal Team', 'General'] as const;
export type RecommendationType = (typeof RECOMMENDATION_TYPES)[number];

export const RECOMMENDATION_STATUSES = ['Proposed', 'Submitted', 'Approved', 'Rejected', 'Applied'] as const;
export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];

export const APPROVAL_REQUEST_TYPES = ['Create Milestone', 'Update Milestone', 'Status Change', 'Other'] as const;
export type ApprovalRequestType = (typeof APPROVAL_REQUEST_TYPES)[number];

export const APPROVAL_STATUSES = ['Pending', 'Approved', 'Rejected'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

// ---- Agent governance ----
export const AGENT_ACTION_TYPES = ['ReadContext', 'CreateRecommendation', 'SubmitApproval', 'CreateMilestone', 'Denied'] as const;
export type AgentActionType = (typeof AGENT_ACTION_TYPES)[number];

export const AGENT_RUN_STATUSES = ['Running', 'Succeeded', 'Failed'] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

/** Standard API error envelope. */
export interface ApiError {
  error: string;
  details?: unknown;
}
