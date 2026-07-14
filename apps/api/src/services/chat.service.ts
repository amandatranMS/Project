import { runOrchestrator } from './chat/orchestrator.js';
import { runFoundryAgent } from './chat/foundryProxy.js';
import type { ChatMessage, TokenSink } from './chat/toolLoop.js';
import { prisma } from '../lib/prisma.js';
import { runWithAgentContext, type AgentTurnContext } from '../lib/agentContext.js';
import type { AuthUser } from '../lib/entraAuth.js';
import { createUserSession } from '../lib/userSessions.js';

export type ChatEngine = 'in-app' | 'foundry';

export const chatService = {
  /**
   * Runs one assistant turn.
   * - 'in-app'  → orchestrator + specialists run in this process (default).
   * - 'foundry' → forwards to the deployed Foundry hosted agent (demo).
   *
   * If `onToken` is supplied, the in-app engine streams the answer token-by-token
   * for a live "typing" experience; the Foundry engine emits its answer in one
   * chunk (its tool calls arrive as separate requests, so we can't stream them).
   *
   * Either way, the conversation (prompts + answers) is captured onto the audit
   * rows created during the turn so investigators can review what led to each
   * governed action.
   */
  async send(messages: ChatMessage[], engine: ChatEngine, user?: AuthUser, onToken?: TokenSink) {
    if (engine === 'foundry') {
      // If a real user is signed in, stash their token and give the hosted agent
      // an opaque session handle so it can act on their behalf (Graph OBO).
      const sessionId =
        user?.kind === 'user' && user.bearer ? createUserSession(user.bearer, user.email) : undefined;

      const startedAt = new Date();
      const reply = await runFoundryAgent(messages, onToken, sessionId);
      const fullConversation = JSON.stringify([...messages, { role: 'assistant', content: reply }]);
      await prisma.agentActionAuditLog.updateMany({
        where: { createdAt: { gte: startedAt }, conversation: null },
        data: { conversation: fullConversation },
      });
      return { reply, engine };
    }

    const ctx: AgentTurnContext = { conversation: messages, createdAuditIds: [] };
    const reply = await runWithAgentContext(ctx, () => runOrchestrator(messages, onToken));

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
