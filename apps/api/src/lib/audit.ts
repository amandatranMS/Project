import { prisma } from '../prisma.js';

/**
 * Records an agent action in the Agent Action Audit Log for governance.
 * Every agent-facing write path must call this so nothing an agent does is silent.
 */
export async function recordAgentAction(params: {
  agentName: string;
  actionType: string;
  actor?: string;
  opportunityId?: string;
  relatedMilestoneId?: string;
  relatedRecommendationId?: string;
  inputSummary?: string;
  outputSummary?: string;
  securityEvent?: boolean;
  result?: 'Success' | 'Blocked' | 'Failed';
  actionName?: string;
}) {
  return prisma.agentActionAuditLog.create({
    data: {
      auditBusinessId: `AU-RUNTIME-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      actionName: params.actionName ?? params.actionType,
      agentName: params.agentName,
      actionType: params.actionType,
      actor: params.actor,
      opportunityId: params.opportunityId,
      relatedMilestoneId: params.relatedMilestoneId,
      relatedRecommendationId: params.relatedRecommendationId,
      inputSummary: params.inputSummary,
      outputSummary: params.outputSummary,
      securityEvent: params.securityEvent ?? false,
      result: params.result ?? 'Success',
    },
  });
}
