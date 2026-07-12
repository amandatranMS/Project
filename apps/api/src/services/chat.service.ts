import { runOrchestrator } from './chat/orchestrator.js';
import { runFoundryAgent } from './chat/foundryProxy.js';
import type { ChatMessage } from './chat/toolLoop.js';
import { prisma } from '../lib/prisma.js';
import { runWithAgentContext, type AgentTurnContext } from '../lib/agentContext.js';

export type ChatEngine = 'in-app' | 'foundry';

export const chatService = {
  /**
   * Runs one assistant turn.
   * - 'in-app'  → orchestrator + specialists run in this process (default).
   * - 'foundry' → forwards to the deployed Foundry hosted agent (demo).
   *
   * For the in-app engine we run the turn inside an AgentTurnContext so any
   * governed action recorded during it captures the conversation. Once the turn
   * finishes we stamp the final answer onto those audit rows so investigators
   * can read the full prompt/answer transcript from the audit log.
   */
  async send(messages: ChatMessage[], engine: ChatEngine) {
    if (engine === 'foundry') {
      const reply = await runFoundryAgent(messages);
      return { reply, engine };
    }

    const ctx: AgentTurnContext = { conversation: messages, createdAuditIds: [] };
    const reply = await runWithAgentContext(ctx, () => runOrchestrator(messages));

    if (ctx.createdAuditIds.length) {
      const fullConversation = JSON.stringify([...messages, { role: 'assistant', content: reply }]);
      await prisma.agentActionAuditLog.updateMany({
        where: { id: { in: ctx.createdAuditIds } },
        data: { conversation: fullConversation },
      });
    }

    return { reply, engine };
  },
};
