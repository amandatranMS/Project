import { prisma } from '../prisma.js';
import type { AgentActionType } from '@msx/shared';

/**
 * Central helper to record every agent action for governance/auditability.
 * All agent-facing endpoints must call this so nothing an agent does is silent.
 */
export async function recordAgentAction(params: {
  agentName: string;
  actionType: AgentActionType;
  entityType?: string;
  entityId?: string;
  approvalRequestId?: string;
  agentRunId?: string | null;
  beforeState?: unknown;
  afterState?: unknown;
  outcome?: 'Success' | 'Blocked' | 'Failed';
  notes?: string;
}) {
  return prisma.agentActionAuditLog.create({
    data: {
      agentName: params.agentName,
      actionType: params.actionType,
      entityType: params.entityType,
      entityId: params.entityId,
      approvalRequestId: params.approvalRequestId,
      agentRunId: params.agentRunId ?? undefined,
      beforeStateJson: params.beforeState ? JSON.stringify(params.beforeState) : undefined,
      afterStateJson: params.afterState ? JSON.stringify(params.afterState) : undefined,
      outcome: params.outcome ?? 'Success',
      notes: params.notes,
    },
  });
}
