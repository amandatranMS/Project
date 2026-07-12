import { prisma } from './prisma.js';
import { genId } from './ids.js';
import { getAgentContext } from './agentContext.js';

/**
 * Records an agent/system action in the Agent Action Audit Log for governance.
 * Every governed write path (approvals, milestone writeback) calls this so no
 * action is silent.
 */
export async function recordAgentAction(params: {
  agentName: string;
  actionType: string;
  actionName?: string;
  actor?: string;
  opportunityId?: string | null;
  relatedMilestoneId?: string | null;
  relatedRecommendationId?: string | null;
  inputSummary?: string;
  outputSummary?: string;
  securityEvent?: boolean;
  result?: 'Success' | 'Failed' | 'Blocked';
}) {
  // If this action happened during an in-app assistant turn, capture the
  // conversation so it can be reviewed from the audit log.
  const turn = getAgentContext();
  const conversation = turn ? JSON.stringify(turn.conversation) : undefined;

  const entry = await prisma.agentActionAuditLog.create({
    data: {
      auditBusinessId: genId('AU'),
      actionName: params.actionName ?? params.actionType,
      agentName: params.agentName,
      actionType: params.actionType,
      actor: params.actor,
      opportunityId: params.opportunityId ?? undefined,
      relatedMilestoneId: params.relatedMilestoneId ?? undefined,
      relatedRecommendationId: params.relatedRecommendationId ?? undefined,
      inputSummary: params.inputSummary,
      outputSummary: params.outputSummary,
      securityEvent: params.securityEvent ?? false,
      result: params.result ?? 'Success',
      conversation,
    },
  });

  // Remember this row so chatService can stamp the final answer onto it once the
  // turn completes.
  if (turn) turn.createdAuditIds.push(entry.id);

  return entry;
}
