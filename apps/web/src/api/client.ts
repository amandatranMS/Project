// Thin fetch wrapper for the MSX Milestone Assistant API.
// Requests go through the Vite dev proxy to the Express backend.
// Every endpoint returns { success, data } | { success, error }; we unwrap it here.

import { apiTokenRequest, authEnabled, msalInstance } from '../auth/msalConfig';

const BASE = '/api';

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Returns an `Authorization: Bearer` header for the signed-in user, or {} when
 * auth is disabled (local dev before the Phase 0 app registration exists).
 */
async function authHeader(): Promise<Record<string, string>> {
  if (!authEnabled || !msalInstance) return {};
  const account = msalInstance.getActiveAccount() ?? msalInstance.getAllAccounts()[0];
  if (!account) return {};
  try {
    const result = await msalInstance.acquireTokenSilent({ ...apiTokenRequest, account });
    return { Authorization: `Bearer ${result.accessToken}` };
  } catch {
    // Silent acquisition failed (e.g. consent/expiry) → force an interactive flow.
    await msalInstance.acquireTokenRedirect(apiTokenRequest);
    return {};
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const auth = await authHeader();
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...auth },
    ...options,
  });
  if (res.status === 204) return undefined as T;

  let body: Envelope<T> | null = null;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    /* non-JSON response */
  }

  if (!res.ok || !body || body.success === false) {
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return body.data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

// ---- Chat assistant ----
export type ChatEngine = 'in-app' | 'foundry';
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}
export interface ChatResult {
  reply: string;
  engine: ChatEngine;
}

/** Send the running transcript to the assistant and get the next reply. */
export function sendChat(messages: ChatTurn[], engine: ChatEngine) {
  return api.post<ChatResult>('/chat', { messages, engine });
}

/**
 * Streaming variant: posts the transcript and invokes `onDelta` with each text
 * chunk as it arrives (live "typing"). Resolves with the full reply, or throws
 * with the server's error message.
 */
export async function sendChatStream(
  messages: ChatTurn[],
  engine: ChatEngine,
  onDelta: (delta: string) => void,
): Promise<string> {
  const res = await fetch(`${BASE}/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ messages, engine }),
  });
  if (!res.ok || !res.body) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as Envelope<unknown>;
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let evt: { delta?: string; done?: boolean; error?: string };
    try {
      evt = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (evt.error) throw new Error(evt.error);
    if (typeof evt.delta === 'string') {
      full += evt.delta;
      onDelta(evt.delta);
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      handleLine(line);
    }
  }
  if (buffer) handleLine(buffer);
  return full;
}

// ---- Response shapes (subset of Prisma models / workbook columns) ----
export interface Opportunity {
  id: string;
  opportunityBusinessId: string;
  opportunityName: string;
  tpid?: string | null;
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
  inputSummary?: string | null;
  outputSummary?: string | null;
  conversation?: string | null;
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
