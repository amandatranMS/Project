/**
 * workbookMappings.ts
 *
 * Maps Excel column headers (from data/MSX_..._.xlsx) to Prisma model fields.
 *
 * Each mapping value is either:
 *   - a string  -> the target Prisma field (treated as plain text), OR
 *   - an object { to, type } where `type` drives conversion:
 *       'string' | 'int' | 'float' | 'bool' | 'date' | 'datetime'
 *
 * Lookup columns (foreign keys) are NOT listed here; they are handled explicitly
 * in parseWorkbook.ts using Prisma `connect` against @unique business keys.
 */

export type FieldType = 'string' | 'int' | 'float' | 'bool' | 'date' | 'datetime';
export type FieldMap = Record<string, string | { to: string; type: FieldType }>;

// Worksheet (tab) names exactly as they appear in the workbook.
export const SHEET_NAMES = {
  opportunity: 'Opportunity',
  milestone: 'Opportunity Milestone',
  statusHistory: 'Milestone Status History',
  recommendation: 'AI Milestone Recommendation',
  approval: 'Approval Request',
  note: 'Collaboration Note',
  dealTeam: 'Deal Team Member',
  notification: 'Agent Notification',
  runLog: 'Agent Run Log',
  auditLog: 'Agent Action Audit Log',
  snapshot: 'Dashboard Metric Snapshot',
} as const;

// 1. Opportunity
export const opportunityMapping: FieldMap = {
  'Opportunity ID': 'opportunityBusinessId',
  'Opportunity Name': 'opportunityName',
  TPID: 'tpid',
  'Customer Name': 'customerName',
  Industry: 'industry',
  'Solution Area': 'solutionArea',
  'Sales Stage': 'salesStage',
  Status: 'status',
  'Estimated Revenue': { to: 'estimatedRevenue', type: 'float' },
  'Close Date': { to: 'closeDate', type: 'date' },
  'AE Owner': 'aeOwner',
  'Assigned SE': 'assignedSE',
  'Competitor Name': 'competitorName',
  'Consumption Phase': 'consumptionPhase',
  'Business Problem': 'businessProblem',
  'Next Step': 'nextStep',
  'Last Updated': { to: 'lastUpdated', type: 'date' },
};

// 2. Opportunity Milestone ("Opportunity" -> connect by opportunityName)
export const milestoneMapping: FieldMap = {
  'Milestone ID': 'milestoneBusinessId',
  'Milestone Name': 'milestoneName',
  Workload: 'workload',
  'Customer Commitment': 'customerCommitment',
  'Delivered By': 'deliveredBy',
  'Partner Name': 'partnerName',
  'Milestone Category': 'milestoneCategory',
  'Est Date': { to: 'estDate', type: 'date' },
  'Fit Charge': { to: 'fitCharge', type: 'float' },
  'Non Recurring': { to: 'nonRecurring', type: 'bool' },
  Comments: 'comments',
  'Milestone Status': 'milestoneStatus',
  'Status Reason': 'statusReason',
  'Risk Description': 'riskDescription',
  'Risk Impact': 'riskImpact',
  'Mitigation Plan': 'mitigationPlan',
  'Blocked Reason': 'blockedReason',
  'Blocked Owner': 'blockedOwner',
  'Blocked Since': { to: 'blockedSince', type: 'date' },
  'Expected Resolution Date': { to: 'expectedResolutionDate', type: 'date' },
  Escalated: { to: 'escalated', type: 'bool' },
  'Competitor Name': 'competitorName',
  'Azure Capacity Type': 'azureCapacityType',
  'Preferred Azure Region': 'preferredAzureRegion',
  Owner: 'owner',
  'Created By': 'createdBy',
  'Last Updated': { to: 'lastUpdated', type: 'date' },
};

// 3. Milestone Status History ("Milestone" -> MS id, "Opportunity" -> name)
export const statusHistoryMapping: FieldMap = {
  'Status History ID': 'statusHistoryBusinessId',
  'Old Status': 'oldStatus',
  'New Status': 'newStatus',
  'Status Date': { to: 'statusDate', type: 'date' },
  Reason: 'reason',
  'Changed By': 'changedBy',
  'Agent Flagged': { to: 'agentFlagged', type: 'bool' },
};

// 4. AI Milestone Recommendation ("Opportunity" name, "Related Milestone" MS id)
export const recommendationMapping: FieldMap = {
  'Recommendation ID': 'recommendationBusinessId',
  'Recommended Milestone Title': 'recommendedMilestoneTitle',
  'Suggested Description': 'suggestedDescription',
  'Suggested Owner Role': 'suggestedOwnerRole',
  'Suggested Due Date': { to: 'suggestedDueDate', type: 'date' },
  Priority: 'priority',
  'Business Value': 'businessValue',
  'Risk or Dependency': 'riskOrDependency',
  Confidence: 'confidence',
  'Human Review Required': { to: 'humanReviewRequired', type: 'bool' },
  'Review Status': 'reviewStatus',
  'Reviewer Notes': 'reviewerNotes',
  'Ready for Mock Creation': { to: 'readyForMockCreation', type: 'bool' },
  'Created By Agent': { to: 'createdByAgent', type: 'bool' },
};

// 5. Approval Request (lookups: Opportunity name, Related Recommendation REC id, Related Milestone MS id)
export const approvalMapping: FieldMap = {
  'Approval Request ID': 'approvalRequestBusinessId',
  'Request Name': 'requestName',
  'Request Status': 'requestStatus',
  'Approval Status': 'approvalStatus',
  'Requested By': 'requestedBy',
  'Approved By': 'approvedBy',
  'Approved On': { to: 'approvedOn', type: 'date' },
  'Mock Writeback Status': 'mockWritebackStatus',
  'Error Message': 'errorMessage',
};

// 6. Collaboration Note (lookups: Opportunity name, Related Milestone MS id)
export const noteMapping: FieldMap = {
  'Collaboration Note ID': 'collaborationNoteBusinessId',
  'Note Title': 'noteTitle',
  'Note Type': 'noteType',
  'Team Area': 'teamArea',
  'Note Summary': 'noteSummary',
  'Suggested Audience': 'suggestedAudience',
  'Created By': 'createdBy',
  'Created On': { to: 'createdOn', type: 'date' },
  'Missing Context': 'missingContext',
  'Follow-up Needed': 'followUpNeeded',
};

// 7. Deal Team Member (lookup: Opportunity name)
export const dealTeamMapping: FieldMap = {
  'Deal Team Member ID': 'dealTeamMemberBusinessId',
  'Person Name': 'personName',
  Role: 'role',
  'Team Area': 'teamArea',
  'Added Date': { to: 'addedDate', type: 'date' },
  Active: { to: 'active', type: 'bool' },
  'Handoff Required': { to: 'handoffRequired', type: 'bool' },
  'Handoff Notes': 'handoffNotes',
};

// 8. Agent Notification (lookups: Opportunity name, Related Milestone MS id)
export const notificationMapping: FieldMap = {
  'Notification ID': 'notificationBusinessId',
  Severity: 'severity',
  'Notify Role': 'notifyRole',
  Message: 'message',
  Status: 'status',
  'Created Date': { to: 'createdDate', type: 'date' },
  'Reason Code': 'reasonCode',
};

// 9. Agent Run Log (lookups: Opportunity name, Related Milestone MS id)
export const runLogMapping: FieldMap = {
  'Run Name': 'runName',
  'Agent Name': 'agentName',
  'Run Type': 'runType',
  'Start Time': { to: 'startTime', type: 'datetime' },
  'End Time': { to: 'endTime', type: 'datetime' },
  Status: 'status',
  'Number of Tool Calls': { to: 'numberOfToolCalls', type: 'int' },
  'Number of Records Read': { to: 'numberOfRecordsRead', type: 'int' },
  'Number of Records Created': { to: 'numberOfRecordsCreated', type: 'int' },
  'Number of Recommendations Generated': { to: 'numberOfRecommendationsGenerated', type: 'int' },
  Notes: 'notes',
};

// 10. Agent Action Audit Log (lookups: Opportunity name, Related Milestone MS id, Related Recommendation REC id)
export const auditLogMapping: FieldMap = {
  'Audit ID': 'auditBusinessId',
  'Action Name': 'actionName',
  'Agent Name': 'agentName',
  'Action Type': 'actionType',
  Actor: 'actor',
  Timestamp: { to: 'timestamp', type: 'datetime' },
  'Input Summary': 'inputSummary',
  'Output Summary': 'outputSummary',
  'Security Event': { to: 'securityEvent', type: 'bool' },
  Result: 'result',
};

// 11. Dashboard Metric Snapshot (no lookups)
export const snapshotMapping: FieldMap = {
  'Snapshot Name': 'snapshotName',
  'Snapshot Date': { to: 'snapshotDate', type: 'datetime' },
  'Total Agent Runs': { to: 'totalAgentRuns', type: 'int' },
  'Recommendations Generated': { to: 'recommendationsGenerated', type: 'int' },
  'Recommendations Approved': { to: 'recommendationsApproved', type: 'int' },
  'Mock Milestones Created': { to: 'mockMilestonesCreated', type: 'int' },
  'Updates Made': { to: 'updatesMade', type: 'int' },
  'Failed Actions': { to: 'failedActions', type: 'int' },
  'Blocked Milestones': { to: 'blockedMilestones', type: 'int' },
  'At Risk Milestones': { to: 'atRiskMilestones', type: 'int' },
  'Lost To Competitor Milestones': { to: 'lostToCompetitorMilestones', type: 'int' },
  'Pending Approvals': { to: 'pendingApprovals', type: 'int' },
  'Last Scheduled Run Status': 'lastScheduledRunStatus',
};
