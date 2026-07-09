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

// ---- Shared response shapes (subset of Prisma models) ----
export interface Opportunity {
  id: string;
  name: string;
  accountName: string;
  customerSegment: string;
  dealStage: string;
  estimatedValue: number;
  currency: string;
  probability: number;
  owner: string;
  partnerName?: string | null;
  competitorName?: string | null;
  competitorThreatLevel?: string | null;
  riskLevel: string;
  riskNotes?: string | null;
  status: string;
  closeDate?: string | null;
  _count?: { milestones: number };
}

export interface Milestone {
  id: string;
  opportunityId: string;
  title: string;
  description?: string | null;
  milestoneType: string;
  status: string;
  priority: string;
  owner: string;
  dueDate?: string | null;
  blockerDescription?: string | null;
  blockerStatus: string;
  riskAssessment?: string | null;
  riskScore: number;
  opportunity?: { id: string; name: string; accountName: string };
}

export interface Recommendation {
  id: string;
  title: string;
  recommendationText: string;
  rationale?: string | null;
  recommendationType: string;
  confidenceScore: number;
  generatedByAgent: string;
  status: string;
  milestoneId?: string | null;
  opportunityId?: string | null;
  createdAt: string;
}

export interface ApprovalRequest {
  id: string;
  requestType: string;
  requestedBy: string;
  summary: string;
  payloadJson: string;
  status: string;
  reviewedBy?: string | null;
  decisionNotes?: string | null;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  agentName: string;
  actionType: string;
  entityType?: string | null;
  entityId?: string | null;
  outcome: string;
  notes?: string | null;
  performedAt: string;
}

export interface DashboardMetrics {
  openOpportunities: number;
  totalMilestones: number;
  milestonesAtRisk: number;
  blockedMilestones: number;
  pendingApprovals: number;
  openPipelineValue: number;
}

export interface Notification {
  id: string;
  recipient: string;
  notificationType: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}
