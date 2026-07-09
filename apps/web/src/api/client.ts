// Thin fetch wrapper for the MSX Milestone Assistant API.
// Requests go through the Vite dev proxy to the Express backend.

const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

// ---- Response shapes (subset of Prisma models / workbook columns) ----
export interface Opportunity {
  id: string;
  opportunityBusinessId: string;
  opportunityName: string;
  customerName?: string | null;
  industry?: string | null;
  solutionArea?: string | null;
  salesStage?: string | null;
  status?: string | null;
  estimatedRevenue?: number | null;
  closeDate?: string | null;
  aeOwner?: string | null;
  assignedSE?: string | null;
  competitorName?: string | null;
  businessProblem?: string | null;
  nextStep?: string | null;
  _count?: { milestones: number };
}

export interface Milestone {
  id: string;
  milestoneBusinessId: string;
  milestoneName: string;
  opportunityId: string;
  workload?: string | null;
  milestoneCategory?: string | null;
  milestoneStatus?: string | null;
  partnerName?: string | null;
  estDate?: string | null;
  fitCharge?: number | null;
  riskDescription?: string | null;
  riskImpact?: string | null;
  blockedReason?: string | null;
  competitorName?: string | null;
  owner?: string | null;
  opportunity?: { id: string; opportunityName: string; customerName?: string | null };
}

export interface Recommendation {
  id: string;
  recommendationBusinessId: string;
  recommendedMilestoneTitle?: string | null;
  suggestedDescription?: string | null;
  priority?: string | null;
  confidence?: string | null;
  reviewStatus?: string | null;
  readyForMockCreation?: boolean | null;
  opportunity?: { opportunityName: string } | null;
}

export interface ApprovalRequest {
  id: string;
  approvalRequestBusinessId: string;
  requestName?: string | null;
  requestStatus?: string | null;
  approvalStatus?: string | null;
  requestedBy?: string | null;
  approvedBy?: string | null;
  mockWritebackStatus?: string | null;
  opportunity?: { opportunityName: string } | null;
  relatedRecommendation?: { recommendationBusinessId: string; recommendedMilestoneTitle?: string | null } | null;
  relatedMilestone?: { milestoneBusinessId: string; milestoneName: string } | null;
}

export interface AuditLog {
  id: string;
  auditBusinessId: string;
  actionName?: string | null;
  agentName?: string | null;
  actionType?: string | null;
  actor?: string | null;
  result?: string | null;
  securityEvent?: boolean | null;
  outputSummary?: string | null;
  timestamp?: string | null;
  createdAt: string;
}

export interface DashboardMetrics {
  activeOpportunities: number;
  totalMilestones: number;
  milestonesAtRisk: number;
  blockedMilestones: number;
  pendingApprovals: number;
  pipelineValue: number;
}

export interface Notification {
  id: string;
  notificationBusinessId: string;
  severity?: string | null;
  notifyRole?: string | null;
  message?: string | null;
  status?: string | null;
  createdDate?: string | null;
}
